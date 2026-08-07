// api/chat/widget/embed.ts — Serves the widget JavaScript (self-contained, no deps)
// GET /api/chat/widget/embed.js?token=<website_token>
//
// Embed on any HTML page:
//   <script src="https://portal.com/api/chat/widget/embed.js?token=XXX" async></script>

import type { VercelRequest, VercelResponse } from '@vercel/node'

const WIDGET_JS = `(function(){
  var TOKEN = '__TOKEN__';
  var BASE = '__BASE__';
  var SESSION_KEY = 'cw_session_' + TOKEN;
  var UI_STATE_KEY = 'cw_ui_open_' + TOKEN;
  var POLL_INTERVAL = 3000;
  var CONFIG = null, SESSION = null, CONV_ID = null, LAST_TS = new Date(0).toISOString();
  var opened = localStorage.getItem(UI_STATE_KEY) === '1';
  var pollTimer = null;
  var messages = [];
  var contactInfo = null;

  // ─── Fetch helper ─────────────────────────────────────────────────────────
  function api(path, opts) {
    return fetch(BASE + '/api/chat/widget/' + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, opts || {})).then(function(r){ return r.json(); });
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'style') Object.assign(e.style, attrs[k]);
      else if (k === 'onclick') e.onclick = attrs[k];
      else if (k === 'onkeydown') e.onkeydown = attrs[k];
      else if (k === 'onsubmit') e.onsubmit = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function(c){
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
  }

  // ─── Widget UI ────────────────────────────────────────────────────────────
  var root, launcher, panel, msgList, inputEl, formEl;

  function ensureRoot() {
    if (root) return root;
    root = el('div', { id: 'cw-widget-root', style: {
      position: 'fixed', bottom: '20px',
      right: (CONFIG && CONFIG.config.position === 'bottom-left') ? 'auto' : '20px',
      left: (CONFIG && CONFIG.config.position === 'bottom-left') ? '20px' : 'auto',
      zIndex: 2147483000,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    }});
    document.body.appendChild(root);
    return root;
  }

  function renderLauncher() {
    ensureRoot();
    if (launcher) launcher.remove();
    var color = CONFIG.config.widget_color || '#B6FF00';
    launcher = el('button', {
      style: {
        width: '56px', height: '56px', borderRadius: '50%',
        background: color, border: 'none', cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
      onclick: toggle,
      title: CONFIG.name,
    });
    launcher.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    root.appendChild(launcher);
  }

  function renderPanel() {
    if (panel) panel.remove();
    var color = CONFIG.config.widget_color || '#B6FF00';
    panel = el('div', { style: {
      position: 'absolute', bottom: '72px',
      right: (CONFIG.config.position === 'bottom-left') ? 'auto' : '0',
      left: (CONFIG.config.position === 'bottom-left') ? '0' : 'auto',
      width: '360px', height: '520px', maxHeight: 'calc(100vh - 120px)',
      background: '#fff', borderRadius: '12px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }});

    // Header
    panel.appendChild(el('div', {
      style: { background: color, padding: '16px', color: '#000' },
    }, [
      el('div', { style: { fontSize: '16px', fontWeight: '700' }}, CONFIG.config.welcome_title),
      el('div', { style: { fontSize: '12px', opacity: '0.8', marginTop: '2px' }}, CONFIG.config.welcome_tagline),
      el('button', {
        style: { position: 'absolute', top: '12px', right: '12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px' },
        onclick: toggle, html: '×',
      }),
    ]));

    // Body
    var body = el('div', { style: { flex: '1', overflow: 'hidden', display: 'flex', flexDirection: 'column' }});

    if (!CONV_ID) {
      body.appendChild(renderPreChatForm());
    } else {
      msgList = el('div', { id: 'cw-msg-list', style: {
        flex: '1', overflowY: 'auto', padding: '12px 16px', background: '#f9fafb',
      }});
      body.appendChild(msgList);
      body.appendChild(renderInputBar());
      renderMessages();
    }
    panel.appendChild(body);

    // Powered by
    panel.appendChild(el('div', {
      style: { textAlign: 'center', padding: '4px', fontSize: '10px', color: '#999' }
    }, 'Powered by Rainmaker.vn'));

    root.appendChild(panel);
  }

  function renderPreChatForm() {
    var fields = CONFIG.config.pre_chat_form_fields || [];
    var container = el('div', { style: { padding: '16px', overflowY: 'auto' }});
    container.appendChild(el('p', { style: { fontSize: '13px', color: '#666', marginBottom: '12px' }},
      'Vui lòng cung cấp một chút thông tin để chúng tôi hỗ trợ bạn tốt hơn:'));

    formEl = el('form', { onsubmit: function(e){ e.preventDefault(); submitPreChatForm(); }});
    fields.forEach(function(f) {
      var wrap = el('div', { style: { marginBottom: '10px' }});
      wrap.appendChild(el('label', {
        style: { display: 'block', fontSize: '11px', color: '#666', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.5px' },
      }, f.label + (f.required ? ' *' : '')));
      var input = el('input', {
        name: f.name, type: f.type || 'text', required: f.required ? 'required' : null,
        style: { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #e5e7eb', borderRadius: '6px', boxSizing: 'border-box' },
      });
      wrap.appendChild(input);
      formEl.appendChild(wrap);
    });
    formEl.appendChild(el('div', { style: { marginBottom: '10px' }}, [
      el('label', {
        style: { display: 'block', fontSize: '11px', color: '#666', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.5px' },
      }, 'Tin nhắn'),
      el('textarea', {
        name: 'initial_message', rows: '3',
        style: { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #e5e7eb', borderRadius: '6px', boxSizing: 'border-box', resize: 'vertical' },
      }),
    ]));
    var color = CONFIG.config.widget_color || '#B6FF00';
    formEl.appendChild(el('button', {
      type: 'submit',
      style: { width: '100%', padding: '10px', background: color, border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' },
    }, 'Bắt đầu chat'));
    container.appendChild(formEl);
    return container;
  }

  function submitPreChatForm() {
    var data = new FormData(formEl);
    var body = { session_token: SESSION };
    data.forEach(function(v, k){ body[k] = v; });
    body.source = {
      url: window.location.href,
      funnel_id: window.__FUNNEL_ID__ || undefined,
      step_id: window.__STEP_ID__ || undefined,
    };
    api('conversation?action=start', { method: 'POST', body: JSON.stringify(body) })
      .then(function(r){
        if (r.error) { alert('Lỗi: ' + r.error); return; }
        CONV_ID = r.conversation_id;
        contactInfo = { name: body.name, email: body.email };
        renderPanel();
        startPolling();
      });
  }

  function renderInputBar() {
    var bar = el('div', { style: { borderTop: '1px solid #e5e7eb', padding: '10px', background: '#fff' }});
    inputEl = el('textarea', {
      rows: '2', placeholder: 'Nhập tin nhắn...',
      style: { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #e5e7eb', borderRadius: '6px', boxSizing: 'border-box', resize: 'none' },
      onkeydown: function(e){
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      },
    });
    bar.appendChild(inputEl);
    return bar;
  }

  function sendMessage() {
    var content = inputEl.value.trim();
    if (!content) return;
    inputEl.value = '';
    // Optimistic add
    var localMsg = { id: 'local-' + Date.now(), content: content, sender_type: 'contact', created_at: new Date().toISOString() };
    messages.push(localMsg);
    renderMessages();
    api('conversation?action=message', {
      method: 'POST',
      body: JSON.stringify({ session_token: SESSION, content: content }),
    }).then(function(r){
      if (r.error) { alert('Không gửi được: ' + r.error); return; }
      // Message will re-appear via poll — remove local placeholder
      messages = messages.filter(function(m){ return m.id !== localMsg.id; });
    });
  }

  function renderMessages() {
    if (!msgList) return;
    msgList.innerHTML = '';
    messages.forEach(function(m){
      var isContact = m.sender_type === 'contact';
      var isSystem = m.sender_type === 'system';
      var color = CONFIG.config.widget_color || '#B6FF00';
      var wrap = el('div', { style: { marginBottom: '8px', display: 'flex', justifyContent: isContact ? 'flex-end' : (isSystem ? 'center' : 'flex-start') }});
      var bubble = el('div', {
        style: {
          maxWidth: '75%',
          padding: isSystem ? '4px 10px' : '8px 12px',
          borderRadius: isSystem ? '12px' : (isContact ? '12px 12px 4px 12px' : '12px 12px 12px 4px'),
          background: isSystem ? 'transparent' : (isContact ? color : '#fff'),
          color: isSystem ? '#999' : '#000',
          border: isSystem ? 'none' : (isContact ? 'none' : '1px solid #e5e7eb'),
          fontSize: isSystem ? '11px' : '13px',
          lineHeight: '1.4', wordBreak: 'break-word',
          fontStyle: isSystem ? 'italic' : 'normal',
        },
      }, m.content || '');
      wrap.appendChild(bubble);
      msgList.appendChild(wrap);
    });
    msgList.scrollTop = msgList.scrollHeight;
  }

  function poll() {
    if (!CONV_ID) return;
    api('conversation?action=poll&session_token=' + encodeURIComponent(SESSION) + '&since=' + encodeURIComponent(LAST_TS))
      .then(function(r){
        if (r.messages && r.messages.length) {
          r.messages.forEach(function(m){
            messages.push(m);
            LAST_TS = m.created_at;
          });
          renderMessages();
        }
      });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_INTERVAL);
    poll();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function toggle() {
    opened = !opened;
    localStorage.setItem(UI_STATE_KEY, opened ? '1' : '0');
    if (opened) {
      renderPanel();
      if (CONV_ID) startPolling();
    } else {
      if (panel) { panel.remove(); panel = null; }
      stopPolling();
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    api('config?token=' + encodeURIComponent(TOKEN))
      .then(function(cfg) {
        if (cfg.error) { console.warn('[chat-widget]', cfg.error); return; }
        CONFIG = cfg;

        var storedSession = localStorage.getItem(SESSION_KEY);
        return api('session', {
          method: 'POST',
          body: JSON.stringify({
            token: TOKEN,
            session_token: storedSession,
            meta: {
              first_seen_url: window.location.href,
              referrer: document.referrer,
              funnel_slug: window.__FUNNEL_SLUG__ || undefined,
              step_slug: window.__STEP_SLUG__ || undefined,
              utm: (function(){
                try { return JSON.parse(localStorage.getItem('funnel_utm') || '{}'); } catch(e){ return {}; }
              })(),
            },
          }),
        });
      })
      .then(function(s) {
        if (!s || s.error) { console.warn('[chat-widget] session error', s && s.error); return; }
        SESSION = s.session_token;
        localStorage.setItem(SESSION_KEY, SESSION);
        CONV_ID = s.conversation_id || null;
        renderLauncher();
        if (opened) {
          renderPanel();
          if (CONV_ID) startPolling();
        }
      })
      .catch(function(e){ console.warn('[chat-widget] boot error', e); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();`

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const url = new URL(req.url || '', 'http://localhost')
  const token = url.searchParams.get('token') || ''
  const base = process.env.CUSTOMER_PORTAL_URL || `${url.protocol}//${req.headers.host}`

  const js = WIDGET_JS.replace(/__TOKEN__/g, token.replace(/[^a-f0-9]/gi, '')).replace(/__BASE__/g, base)
  return res.status(200).send(js)
}
