Deno.serve(async (req) => {
  const url = new URL(req.url);
  const memberNumber = url.searchParams.get('memberNumber') || '';
  const screen = url.searchParams.get('screen') || '';
  let dest = 'https://app.dtmhandicap.com/';
  const params = new URLSearchParams();
  if (memberNumber) params.set('memberNumber', memberNumber);
  if (screen) params.set('screen', screen);
  const qs = params.toString();
  if (qs) dest += '?' + qs;
  return new Response(null, { status: 302, headers: { Location: dest } });
});
