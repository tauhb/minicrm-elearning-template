/**
 * services/funnel-context.ts — Single source of truth for step-level business context.
 *
 * `resolveStepContext(stepId)` loads: the step, its funnel, the assigned product,
 * effective price, next/prev siblings, upsell target product, and form fields.
 * Both draft and block-render prompts pipe this into a `# FUNNEL CONTEXT` block
 * so AI copy can reference the actual product name, price, and next-step CTA
 * instead of writing generic text.
 *
 * Read-only. Uses service-role admin client. Never touches user input.
 */

import { createClient } from '@supabase/supabase-js'

export interface StepContext {
  funnel: {
    id: string
    slug: string
    name: string
    type_key: string                   // 'sales' | 'leads' | 'webinar' | 'booking' | 'challenge'
    payment_mode: string                // 'inline_qr' | 'collect_only' | 'none'
    sepay_configured: boolean
    bank_name?: string
    shared_context: Record<string, any>
    tags_to_apply: string[]
  }
  step: {
    id: string
    slug: string
    name: string
    page_type: string                   // 'landing' | 'order' | 'upsell' | 'thank-you' | 'opt-in' | ...
    step_number: number
    has_form: boolean
    form_mode: string
    form_fields: FormFieldSpec[]
  }
  product: ProductSummary | null        // assigned to THIS step
  effective_price: {
    amount: number
    currency: 'VND'
    source: 'override' | 'product' | 'funnel-config' | 'none'
  } | null
  next_step: SiblingRef | null          // form_success_step_slug > next by step_number
  prev_step: SiblingRef | null          // preceding by step_number
  order_step: SiblingRef & { product: ProductSummary | null; amount: number } | null
                                        // For landing/upsell/thank-you: what product is being sold in the funnel
  upsell: {
    product: ProductSummary | null
    amount: number
    description?: string
    accept_label?: string
    skip_label?: string
  } | null                              // Only present on funnels that HAVE an upsell step (from any step's POV)
  siblings: SiblingRef[]                // all steps ordered by step_number
  chat_widget_active: boolean
}

export interface FormFieldSpec {
  name: string
  label: string
  type: string
  required?: boolean
  placeholder?: string
}

export interface ProductSummary {
  id: string
  name: string
  price: number | null
  type?: string
  slug?: string
  description?: string
}

export interface SiblingRef {
  id: string
  slug: string
  name: string
  page_type: string
  step_number: number
  has_form?: boolean
  url_path: string                      // '/f/{funnel_slug}/{slug}'
}

function adminDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function resolveStepContext(stepId: string): Promise<StepContext | null> {
  const db = adminDb()
  const { data: step } = await db.from('funnel_steps').select('*').eq('id', stepId).maybeSingle()
  if (!step) return null

  const { data: flow } = await db.from('funnel_flows')
    .select('id, slug, name, type_key, payment_mode, payment_config, shared_context, tags_to_apply, chat_widget_inbox_id')
    .eq('id', step.funnel_id).maybeSingle()
  if (!flow) return null

  const { data: siblingRows } = await db.from('funnel_steps')
    .select('id, slug, name, page_type, step_number, has_form, assigned_product_id, price_override, upsell_config, form_success_step_slug')
    .eq('funnel_id', flow.id).order('step_number')
  const siblings = (siblingRows || [])

  // Collect all product ids we might need (step's own + all assigned across the funnel)
  const productIds = Array.from(new Set(
    siblings.map(s => s.assigned_product_id).filter(Boolean) as string[]
  ))
  const productMap = new Map<string, ProductSummary>()
  if (productIds.length) {
    const { data: prods } = await db.from('products')
      .select('id, name, price, type, slug, description').in('id', productIds)
    for (const p of (prods || [])) {
      productMap.set(p.id, {
        id: p.id, name: p.name,
        price: typeof p.price === 'number' ? p.price : null,
        type: p.type, slug: p.slug, description: p.description || undefined,
      })
    }
  }

  const toRef = (s: any): SiblingRef => ({
    id: s.id, slug: s.slug, name: s.name, page_type: s.page_type,
    step_number: s.step_number, has_form: !!s.has_form,
    url_path: `/f/${flow.slug}/${s.slug}`,
  })

  const stepIdx = siblings.findIndex(s => s.id === step.id)
  const stepRow = siblings[stepIdx] || step

  // Resolve next_step: form_success_step_slug > next by step_number
  let nextRow: any = null
  if (stepRow.form_success_step_slug) {
    nextRow = siblings.find(s => s.slug === stepRow.form_success_step_slug) || null
  }
  if (!nextRow && stepIdx >= 0) {
    nextRow = siblings.slice(stepIdx + 1).find(s => s.step_number > stepRow.step_number) || null
  }
  const prevRow = stepIdx > 0 ? siblings[stepIdx - 1] : null

  // Own product + effective price
  const product = stepRow.assigned_product_id ? (productMap.get(stepRow.assigned_product_id) || null) : null
  let effective_price: StepContext['effective_price'] = null
  if (stepRow.price_override != null) {
    effective_price = { amount: Number(stepRow.price_override), currency: 'VND', source: 'override' }
  } else if (product?.price != null) {
    effective_price = { amount: product.price, currency: 'VND', source: 'product' }
  } else if ((flow.payment_config as any)?.fixed_amount) {
    effective_price = { amount: Number((flow.payment_config as any).fixed_amount), currency: 'VND', source: 'funnel-config' }
  }

  // For landing/thank-you/upsell context: what's the funnel's main product? (order step)
  const orderSibling = siblings.find(s => s.page_type === 'order')
  let order_step: StepContext['order_step'] = null
  if (orderSibling) {
    const orderProduct = orderSibling.assigned_product_id ? (productMap.get(orderSibling.assigned_product_id) || null) : null
    const orderAmount = orderSibling.price_override != null ? Number(orderSibling.price_override)
                      : (orderProduct?.price ?? Number((flow.payment_config as any)?.fixed_amount) ?? 0)
    order_step = { ...toRef(orderSibling), product: orderProduct, amount: orderAmount }
  }

  // Upsell context (any step in this funnel with page_type=upsell)
  const upsellSibling = siblings.find(s => s.page_type === 'upsell')
  let upsell: StepContext['upsell'] = null
  if (upsellSibling) {
    const upProduct = upsellSibling.assigned_product_id ? (productMap.get(upsellSibling.assigned_product_id) || null) : null
    const upAmount = upsellSibling.price_override != null ? Number(upsellSibling.price_override)
                    : (upProduct?.price ?? 0)
    const cfg: any = upsellSibling.upsell_config || {}
    upsell = {
      product: upProduct,
      amount: upAmount,
      description: cfg.description || undefined,
      accept_label: cfg.accept_label || undefined,
      skip_label: cfg.skip_label || undefined,
    }
  }

  const pc: any = flow.payment_config || {}
  return {
    funnel: {
      id: flow.id, slug: flow.slug, name: flow.name,
      type_key: flow.type_key,
      payment_mode: flow.payment_mode,
      sepay_configured: !!(pc.account_number && flow.payment_mode === 'inline_qr'),
      bank_name: pc.bank_name || undefined,
      shared_context: (flow.shared_context as any) || {},
      tags_to_apply: (flow.tags_to_apply as string[]) || [],
    },
    step: {
      id: step.id, slug: step.slug, name: step.name, page_type: step.page_type,
      step_number: step.step_number, has_form: !!step.has_form,
      form_mode: step.form_mode || 'none',
      form_fields: (step.form_fields as FormFieldSpec[]) || [],
    },
    product,
    effective_price,
    next_step: nextRow ? toRef(nextRow) : null,
    prev_step: prevRow ? toRef(prevRow) : null,
    order_step,
    upsell,
    siblings: siblings.map(toRef),
    chat_widget_active: !!(flow as any).chat_widget_inbox_id,
  }
}

// ─── Prompt rendering ──────────────────────────────────────────────────────

const fmtVND = (n: number) => n > 0 ? new Intl.NumberFormat('vi-VN').format(n) + '₫' : '(chưa gán giá)'

/**
 * Turn a StepContext into a natural-language `# FUNNEL CONTEXT` block for the
 * system prompt. Content is page_type-aware so the AI gets directive guidance
 * (what CTA text to use, what fields to render, what to reference) — not just
 * a JSON dump.
 */
export function renderContextBlock(ctx: StepContext): string {
  const lines: string[] = ['# FUNNEL CONTEXT (dùng để viết copy đúng business, đúng navigation)', '']

  // Funnel-level
  lines.push(`- Funnel: **${ctx.funnel.name}** (type=${ctx.funnel.type_key}, ${ctx.siblings.length} steps)`)
  lines.push(`- Step hiện tại: **${ctx.step.name}** (page_type=${ctx.step.page_type}, bước ${ctx.step.step_number}/${ctx.siblings.length})`)
  if (ctx.next_step) {
    lines.push(`- Kế tiếp: **${ctx.next_step.name}** (${ctx.next_step.page_type}) → ${ctx.next_step.url_path}`)
  } else {
    lines.push(`- Không có step kế tiếp (đây là step cuối)`)
  }

  // Product + price (this step)
  if (ctx.product) {
    lines.push(`- Sản phẩm gán cho step: **${ctx.product.name}** — ${fmtVND(ctx.effective_price?.amount || 0)}${ctx.effective_price?.source === 'override' ? ' (giá override)' : ''}`)
    if (ctx.product.description) lines.push(`  · Mô tả: ${ctx.product.description.slice(0, 150)}`)
  }

  // Funnel main product (relevant for landing/upsell/thank-you context)
  if (ctx.order_step && (!ctx.product || ctx.order_step.product?.id !== ctx.product?.id)) {
    if (ctx.order_step.product) {
      lines.push(`- Sản phẩm chính của funnel (bán ở step "${ctx.order_step.name}"): **${ctx.order_step.product.name}** — ${fmtVND(ctx.order_step.amount)}`)
    }
  }

  // Upsell (if funnel has one)
  if (ctx.upsell && ctx.upsell.product && ctx.step.page_type !== 'upsell') {
    lines.push(`- Funnel có upsell sau đơn gốc: **${ctx.upsell.product.name}** — ${fmtVND(ctx.upsell.amount)}${ctx.upsell.description ? ` (${ctx.upsell.description})` : ''}`)
  }

  // Payment
  if (ctx.funnel.payment_mode === 'inline_qr' && ctx.funnel.sepay_configured) {
    lines.push(`- Payment: SePay VietQR (${ctx.funnel.bank_name || 'ngân hàng chưa set'}) — chuyển khoản, xác nhận tự động qua webhook`)
  } else if (ctx.funnel.payment_mode === 'collect_only') {
    lines.push(`- Payment: chỉ thu form, không thanh toán inline (user sẽ được liên hệ thủ công)`)
  }

  // Form (this step)
  if (ctx.step.has_form && ctx.step.form_fields.length > 0) {
    lines.push('', `## Form fields BẮT BUỘC render (đúng name attribute — không tự invent):`)
    for (const f of ctx.step.form_fields) {
      lines.push(`  - \`name="${f.name}"\` type="${f.type}"${f.required ? ' required' : ''} — label: "${f.label}"${f.placeholder ? ` (placeholder: "${f.placeholder}")` : ''}`)
    }
  }

  // Directives per page_type
  lines.push('', `## Yêu cầu copy theo page_type "${ctx.step.page_type}":`)
  switch (ctx.step.page_type) {
    case 'landing': {
      const target = ctx.order_step?.product?.name || ctx.product?.name || 'sản phẩm'
      const price = ctx.order_step?.amount || ctx.effective_price?.amount || 0
      lines.push(`- Đây là trang bán/giới thiệu. CTA chính phải PUSH user sang "${ctx.next_step?.name || 'order'}".`)
      lines.push(`- CTA text PHẢI cụ thể: nhắc tên "${target}"${price > 0 ? ` hoặc giá ${fmtVND(price)}` : ''}. Không được chung chung ("Xem thêm", "Bắt đầu").`)
      lines.push(`- Portal tự inject href vào <a data-cta="1"> — bạn không cần điền href.`)
      break
    }
    case 'opt-in': {
      lines.push(`- Trang thu lead. Form phải rõ giá trị nhận lại (VD "Nhận PDF miễn phí").`)
      lines.push(`- Sau submit → sang ${ctx.next_step?.name || 'step kế tiếp'}.`)
      break
    }
    case 'order': {
      const price = ctx.effective_price?.amount || 0
      lines.push(`- Trang thanh toán. PHẢI có block order summary hiển thị rõ tên sản phẩm "${ctx.product?.name || '(chưa gán)'}" + giá ${fmtVND(price)}.`)
      if (ctx.funnel.sepay_configured) {
        lines.push(`- Sau submit form → user thấy QR VietQR để chuyển khoản ${fmtVND(price)}. Copy tin cậy: "Xác nhận tự động sau khi chuyển", "An toàn qua ngân hàng".`)
      }
      lines.push(`- Không tự invent form field name — dùng đúng name= ở phần form fields trên.`)
      if (ctx.upsell?.product) lines.push(`- Có thể tease nhẹ: "Có ưu đãi bổ sung sau khi thanh toán".`)
      break
    }
    case 'upsell': {
      const upName = ctx.product?.name || '(chưa gán product)'
      const upPrice = ctx.effective_price?.amount || 0
      const parentName = ctx.order_step?.product?.name || '(khoá chính)'
      lines.push(`- Trang upsell. Người xem VỪA mua "${parentName}". Đừng viết như thể họ chưa mua gì.`)
      lines.push(`- Sản phẩm upsell: "${upName}" — ${fmtVND(upPrice)}. Nhấn mạnh value/anchor pricing.`)
      lines.push(`- BẮT BUỘC render 2 CTAs song song ở cuối trang:`)
      lines.push(`  1. \`<button data-cta="upsell-yes">${ctx.upsell?.accept_label || 'CÓ, lấy thêm ưu đãi này'}</button>\` — brand color, nổi bật`)
      lines.push(`  2. \`<a data-cta="upsell-no">${ctx.upsell?.skip_label || 'Cảm ơn, tôi chỉ cần đơn chính'}</a>\` — subtle link text màu xám`)
      lines.push(`- Portal wire sẵn logic: YES → mở modal QR ${fmtVND(upPrice)} tự động. NO → sang thank-you.`)
      break
    }
    case 'thank-you': {
      const parentName = ctx.order_step?.product?.name || '(sản phẩm)'
      lines.push(`- Trang cảm ơn. User đã thanh toán xong "${parentName}".`)
      lines.push(`- Confirm rõ đơn hàng. Instruction check email trong 5-10 phút.`)
      if (ctx.upsell?.product) lines.push(`- Nếu URL có ?upsell_taken=1 → thêm dòng: "Bạn đã bổ sung ${ctx.upsell.product.name}".`)
      lines.push(`- KHÔNG có CTA next. Có thể có link về portal học viên (nếu có).`)
      break
    }
    default:
      lines.push(`- Follow block catalog + formula. Portal wire navigation qua data-cta.`)
  }

  // Shared context (user-supplied narrative)
  if (Object.keys(ctx.funnel.shared_context).length > 0) {
    lines.push('', '## Shared funnel context (do user cung cấp):')
    for (const [k, v] of Object.entries(ctx.funnel.shared_context)) {
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }

  return lines.join('\n')
}
