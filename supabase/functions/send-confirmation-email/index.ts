import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }
  try {
    const payload = await req.json();
    const { user, email_data } = payload;
    const confirmationURL = email_data?.token_hash
      ? `https://euwqnyzzrxrmldmfspjr.supabase.co/auth/v1/verify?token=${email_data.token_hash}&type=${email_data.email_action_type}&redirect_to=https://dtmhandicap.com`
      : email_data?.confirmation_url;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      },
      body: JSON.stringify({
        from: "Down The Middle <noreply@dtmhandicap.com>",
        to: [user.email],
        subject: "Confirm your email address",
        html: '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d1b2e;"><tr><td align="center" style="padding:40px 20px;"><table width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;"><tr><td align="center" style="padding-bottom:8px;"><span style="font-family:Verdana,Geneva,sans-serif;font-size:27px;font-weight:900;letter-spacing:5px;text-transform:uppercase;color:#f5f0e8;display:block;">DOWN THE MIDDLE</span></td></tr><tr><td align="center" style="padding-bottom:20px;"><span style="font-family:Verdana,Geneva,sans-serif;font-size:13px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#e02247;display:block;">A TRUER GOLF HANDICAP</span></td></tr><tr><td style="padding-bottom:28px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="background-color:#e8b84b;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr><tr><td align="center" style="padding-bottom:24px;"><span style="font-family:Verdana,Geneva,sans-serif;font-size:14px;color:#ffffff;line-height:1.8;display:block;">Click the link below to verify your email address<br>and complete your new membership:</span></td></tr><tr><td align="center" style="padding-bottom:8px;"><a href="' + confirmationURL + '" style="background-color:#e8b84b;color:#0d1b2e;font-family:Verdana,Geneva,sans-serif;font-size:12px;font-weight:900;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;border-radius:4px;text-decoration:none;display:inline-block;">VERIFY EMAIL ADDRESS</a></td></tr></table></td></tr></table>',
      }),
    });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
});
