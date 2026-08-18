Deno.serve(async (req) => {
  const url = new URL(req.url);
  const memberNumber = url.searchParams.get('memberNumber') || '';
  const dest = memberNumber
    ? `https://app.dtmhandicap.com/?memberNumber=${encodeURIComponent(memberNumber)}`
    : `https://app.dtmhandicap.com/`;
  return new Response(null, { status: 302, headers: { Location: dest } });
});
