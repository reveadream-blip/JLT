// Supabase Edge Function: create-checkout-session
// Requires secrets (configure via: npx supabase secrets set KEY=value):
// - STRIPE_SECRET_KEY                          (sk_live_... ou sk_test_...)
// - STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990       (price_... du plan abonnement Stripe)
// - STRIPE_PRICE_PROMPTPAY_MONTHLY_990         (price_... du plan PromptPay mensuel, devise THB)
// - STRIPE_PRICE_PROMPTPAY_YEARLY_9900         (price_... du plan PromptPay annuel, devise THB)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont auto-injectes par Supabase.

import Stripe from 'npm:stripe@14.25.0'
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''
const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Trace au boot la presence des secrets (sans jamais leur valeur).
// Visible dans Supabase Dashboard > Edge Functions > create-checkout-session > Logs.
console.log('[boot] secrets check', {
  STRIPE_SECRET_KEY: STRIPE_SECRET_KEY ? `set (${STRIPE_SECRET_KEY.slice(0, 7)}…, len=${STRIPE_SECRET_KEY.length})` : 'MISSING',
  SUPABASE_URL: SUPABASE_URL_ENV ? 'set' : 'MISSING',
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY ? `set (len=${SUPABASE_SERVICE_ROLE_KEY.length})` : 'MISSING',
  STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990: Deno.env.get('STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990') ? 'set' : 'MISSING',
  STRIPE_PRICE_PROMPTPAY_MONTHLY_990: Deno.env.get('STRIPE_PRICE_PROMPTPAY_MONTHLY_990') ? 'set' : 'MISSING',
  STRIPE_PRICE_PROMPTPAY_YEARLY_9900: Deno.env.get('STRIPE_PRICE_PROMPTPAY_YEARLY_9900') ? 'set' : 'MISSING',
})

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

const supabaseAdmin = createClient(SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY)

const PLAN_TO_PRICE_ENV: Record<string, string> = {
  stripe_monthly_auto_990: 'STRIPE_PRICE_STRIPE_MONTHLY_AUTO_990',
  promptpay_monthly_990: 'STRIPE_PRICE_PROMPTPAY_MONTHLY_990',
  promptpay_yearly_9900: 'STRIPE_PRICE_PROMPTPAY_YEARLY_9900',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Extrait un message lisible d'une erreur Stripe ou JS.
function describeError(err: unknown): { message: string; type?: string; code?: string; param?: string; statusCode?: number } {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return {
      message: typeof e.message === 'string' ? e.message : String(err),
      type: typeof e.type === 'string' ? e.type : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
      param: typeof e.param === 'string' ? e.param : undefined,
      statusCode: typeof e.statusCode === 'number' ? e.statusCode : undefined,
    }
  }
  return { message: String(err) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    if (!STRIPE_SECRET_KEY) {
      console.error('[checkout] STRIPE_SECRET_KEY missing in function env')
      return jsonResponse(
        { error: 'Server misconfiguration: STRIPE_SECRET_KEY not set in Edge Function secrets' },
        500,
      )
    }
    if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL_ENV) {
      console.error('[checkout] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
      return jsonResponse(
        { error: 'Server misconfiguration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' },
        500,
      )
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401)
    }
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) {
      return jsonResponse({ error: 'Empty bearer token' }, 401)
    }
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt)
    if (userError) {
      console.error('[checkout] auth.getUser error:', userError.message)
      return jsonResponse(
        { error: `Token verification failed: ${userError.message}` },
        401,
      )
    }
    const user = userData.user
    if (!user) {
      return jsonResponse(
        { error: 'No user resolved from token (probably anon key or expired session)' },
        401,
      )
    }
    if (user.is_anonymous) {
      return jsonResponse(
        { error: 'Anonymous users cannot subscribe. Create a real account first.' },
        401,
      )
    }
    if (!user.email) {
      return jsonResponse({ error: 'User has no email on file' }, 400)
    }

    const body = await req.json().catch(() => ({}))
    const planCode = String(body.planCode || '')
    const successUrl = String(body.successUrl || '')
    const cancelUrl = String(body.cancelUrl || '')
    console.log('[checkout] request', { user_id: user.id, planCode, successUrl, cancelUrl })

    if (!planCode) return jsonResponse({ error: 'Missing planCode in request body' }, 400)
    if (!successUrl) return jsonResponse({ error: 'Missing successUrl in request body' }, 400)
    if (!cancelUrl) return jsonResponse({ error: 'Missing cancelUrl in request body' }, 400)
    const priceEnv = PLAN_TO_PRICE_ENV[planCode]
    if (!priceEnv) return jsonResponse({ error: `Unknown plan code: ${planCode}` }, 400)
    const priceId = Deno.env.get(priceEnv)
    if (!priceId) {
      console.error('[checkout] price env missing', { priceEnv, planCode })
      return jsonResponse(
        { error: `Missing price env: ${priceEnv}. Set it via: npx supabase secrets set ${priceEnv}=price_xxx` },
        500,
      )
    }

    const isStripeRecurring = planCode === 'stripe_monthly_auto_990'
    const sharedMetadata = {
      owner_id: user.id,
      plan_code: planCode,
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create({
        mode: isStripeRecurring ? 'subscription' : 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: user.email,
        metadata: sharedMetadata,
        // Pour les abonnements Stripe recurrents, on propage aussi le metadata
        // vers l'objet Subscription pour retrouver l'owner_id lors des renouvellements.
        subscription_data: isStripeRecurring
          ? { metadata: sharedMetadata }
          : undefined,
        // Pour les paiements PromptPay (one-shot), on attache le metadata au PaymentIntent.
        payment_intent_data: !isStripeRecurring
          ? { metadata: sharedMetadata }
          : undefined,
        payment_method_types: isStripeRecurring ? ['card'] : ['promptpay', 'card'],
      })
    } catch (stripeErr) {
      const info = describeError(stripeErr)
      console.error('[checkout] stripe.checkout.sessions.create failed', info)
      return jsonResponse(
        {
          error: `Stripe error: ${info.message}`,
          stripe_type: info.type,
          stripe_code: info.code,
          stripe_param: info.param,
        },
        info.statusCode && info.statusCode >= 400 && info.statusCode < 600 ? info.statusCode : 500,
      )
    }

    const { error: insertErr } = await supabaseAdmin.from('billing_payments').insert({
      owner_id: user.id,
      plan_code: planCode,
      provider: isStripeRecurring ? 'stripe' : 'promptpay',
      amount_thb: 0,
      status: 'pending',
      external_payment_id: session.id,
      checkout_url: session.url,
      metadata: { checkout_mode: session.mode },
    })
    if (insertErr) {
      // On ne bloque pas le checkout (on a deja une session Stripe), mais on logue.
      console.error('[checkout] billing_payments insert failed', insertErr)
    }

    console.log('[checkout] success', { session_id: session.id, url: session.url })
    return jsonResponse({ checkoutUrl: session.url, url: session.url }, 200)
  } catch (error) {
    const info = describeError(error)
    console.error('[checkout] unhandled error', info)
    return jsonResponse({ error: `Unhandled: ${info.message}`, type: info.type, code: info.code }, 500)
  }
})
