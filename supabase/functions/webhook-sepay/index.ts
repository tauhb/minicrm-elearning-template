// supabase/functions/webhook-sepay/index.ts
// Supabase Edge Function — receives SePay payment webhooks and auto-provisions students

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const payload = await req.json()

    // 1. Log the raw webhook event
    const { data: webhookEvent } = await supabase
      .from('webhook_events')
      .insert({ source: 'sepay', payload })
      .select()
      .single()

    // 2. Only process incoming transfers (payments received)
    if (payload.transferType !== 'in') {
      return new Response(JSON.stringify({ received: true, skipped: 'not incoming transfer' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Parse description to extract email and cohort
    // Expected format: "THANHTOAN-K1 user@email.com" or "THANHTOAN user@email.com"
    const description: string = payload.description || payload.content || ''
    const emailMatch = description.match(/[\w.-]+@[\w.-]+\.\w+/)
    if (!emailMatch) {
      await supabase.from('webhook_events').update({ error: 'No email found in description' }).eq('id', webhookEvent?.id)
      return new Response(JSON.stringify({ error: 'No email in description' }), { status: 400, headers: corsHeaders })
    }
    const email = emailMatch[0].toLowerCase()

    // Extract cohort from description: "THANHTOAN-K1" → "K1"
    const cohortMatch = description.match(/THANHTOAN[-_]([A-Z0-9]+)/i)
    const cohort = cohortMatch ? cohortMatch[1].toUpperCase() : 'K1'

    const referenceCode = payload.referenceCode || payload.transactionID || ''

    // 4. Idempotency check — skip if payment already processed
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('gateway_ref', referenceCode)
      .single()

    if (existingPayment) {
      return new Response(JSON.stringify({ received: true, skipped: 'duplicate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 5. Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers()
    const existingUser = existingUsers?.users.find(u => u.email === email)

    let userId: string

    if (existingUser) {
      userId = existingUser.id
      // Update payment status on existing profile
      await supabase.from('customers').update({ payment_status: 'paid', payment_ref: referenceCode }).eq('id', userId)
    } else {
      // 6. Create new Supabase Auth user
      const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true
      })

      if (createError || !newUser?.user) {
        await supabase.from('webhook_events').update({ error: createError?.message }).eq('id', webhookEvent?.id)
        return new Response(JSON.stringify({ error: 'Failed to create user' }), { status: 500, headers: corsHeaders })
      }

      userId = newUser.user.id

      // 7. Create profile
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('customers').insert({
        id: userId,
        email,
        display_name: email.split('@')[0],
        role: 'student',
        cohort,
        start_date: today,
        payment_status: 'paid',
        payment_ref: referenceCode
      })

      // 8. Send magic link email so student can set their password
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: Deno.env.get('SITE_URL') || 'https://your-portal.vercel.app'
        }
      })
    }

    // 9. Record payment
    await supabase.from('payments').insert({
      student_id: userId,
      amount: payload.transferAmount || 0,
      currency: 'VND',
      status: 'completed',
      gateway: 'sepay',
      gateway_ref: referenceCode,
      gateway_payload: payload,
      cohort
    })

    // 10. Mark webhook as processed
    await supabase.from('webhook_events').update({ processed: true }).eq('id', webhookEvent?.id)

    return new Response(JSON.stringify({ success: true, userId, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
