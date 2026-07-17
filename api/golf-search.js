const GOLF_API_KEY = process.env.GOLF_API_KEY;
const GOLF_API_BASE = 'https://www.golfapi.io/api/v2.3';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const rateLimitMap = new Map();
function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxRequests;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip, 30, 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });

  const { action, query, clubId, courseId } = req.method === 'POST'
    ? req.body
    : req.query;

  try {
    // ── Search clubs by name — costs 0.1 calls ────────────────────────────────
    if (action === 'search') {
      if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

      // Check Supabase cache first
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/courses?name=ilike.*${encodeURIComponent(query)}*&select=id,name,location,source,golfapi_id,tees(id,name,rating,slope)&order=name.asc&limit=8`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const cached = await cacheRes.json();
      if (cacheRes.ok && Array.isArray(cached) && cached.length >= 3) {
        return res.status(200).json({ results: cached, source: 'cache' });
      }

      // Hit GolfAPI
      const apiRes = await fetch(
        `${GOLF_API_BASE}/clubs?name=${encodeURIComponent(query)}&country=usa`,
        { headers: { Authorization: `Bearer ${GOLF_API_KEY}` } }
      );
      const apiData = await apiRes.json();
      if (!apiRes.ok) return res.status(500).json({ error: 'GolfAPI search failed' });

      const clubs = apiData.clubs || [];
      return res.status(200).json({
        results: clubs.slice(0, 8).map(c => ({
          golfapi_club_id: c.clubID,
          name: c.clubName,
          location: [c.city, c.state].filter(Boolean).join(', '),
          source: 'golfapi',
          courses: (c.courses || []).map(co => ({ courseID: co.courseID, courseName: co.courseName })),
        })),
        source: 'golfapi',
        apiRequestsLeft: apiData.apiRequestsLeft,
      });
    }

    // ── Fetch club info (returns course list for multi-course picker) — costs 1 call
    if (action === 'fetchClub') {
      if (!clubId) return res.status(400).json({ error: 'clubId required' });

      const clubRes = await fetch(
        `${GOLF_API_BASE}/clubs/${clubId}`,
        { headers: { Authorization: `Bearer ${GOLF_API_KEY}` } }
      );
      const clubData = await clubRes.json();
      if (!clubRes.ok) return res.status(500).json({ error: 'GolfAPI club fetch failed' });

      const club = clubData.clubID ? clubData : clubData.club;
      if (!club) return res.status(404).json({ error: 'Club not found' });

      return res.status(200).json({
        clubId: club.clubID,
        clubName: club.clubName,
        location: [club.city, club.state].filter(Boolean).join(', '),
        courses: (club.courses || []).map(c => ({ courseID: c.courseID, courseName: c.courseName })),
        apiRequestsLeft: clubData.apiRequestsLeft,
      });
    }

    // ── Fetch full course details (tees, ratings, slopes) — costs 1 call ──────
    if (action === 'fetchCourse') {
      if (!courseId || !clubId) return res.status(400).json({ error: 'courseId and clubId required' });

      // Check Supabase cache first
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/courses?golfapi_id=eq.${courseId}&select=id,name,club_name,location,source,golfapi_id,tees(id,name,rating,slope)&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      if (cacheRes.ok) {
        const cachedArr = await cacheRes.json();
        const cached = Array.isArray(cachedArr) ? cachedArr[0] : null;
        if (cached?.id) return res.status(200).json({ course: cached, source: 'cache' });
      }

      // Fetch from GolfAPI
      const courseRes = await fetch(
        `${GOLF_API_BASE}/courses/${courseId}`,
        { headers: { Authorization: `Bearer ${GOLF_API_KEY}` } }
      );
      const courseData = await courseRes.json();
      if (!courseRes.ok) return res.status(500).json({ error: 'GolfAPI course fetch failed' });

      // Build tees
      const tees = [];
      for (const tee of (courseData.tees || [])) {
        const rating = parseFloat(tee.courseRatingMen || tee.courseRatingWomen);
        const slope = parseInt(tee.slopeMen || tee.slopeWomen);
        if (rating && slope && tee.teeName) {
          tees.push({ name: tee.teeName, rating, slope });
        }
      }
      const uniqueTees = tees.filter((t, i, arr) => arr.findIndex(x => x.name === t.name) === i);

      // Use location passed from the app (from search results) — avoids extra lookup
      const { location: passedLocation, clubName: passedClubName } = req.method === 'POST' ? req.body : req.query;
      const courseName = courseData.courseName || passedClubName || 'Unknown Course';
      const courseLocation = passedLocation || '';

      const insertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/courses`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            name: courseName,
            location: courseLocation,
            source: 'golfapi',
            golfapi_id: String(courseId),
            club_name: passedClubName || null,
          }),
        }
      );
      const insertData = await insertRes.json();
      const newCourse = Array.isArray(insertData) ? insertData[0] : insertData;

      if (newCourse?.id && uniqueTees.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/tees`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(uniqueTees.map(t => ({ ...t, course_id: newCourse.id }))),
        });
      }

      // Return full course with tees
      const finalRes = await fetch(
        `${SUPABASE_URL}/rest/v1/courses?id=eq.${newCourse?.id}&select=id,name,club_name,location,source,golfapi_id,tees(id,name,rating,slope)`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const finalArr = await finalRes.json();
      const final = Array.isArray(finalArr) ? finalArr[0] : finalArr;

      return res.status(200).json({
        course: final,
        source: 'golfapi',
        apiRequestsLeft: courseData.apiRequestsLeft,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (e) {
    console.error('golf-search error:', e);
    return res.status(500).json({ error: 'Server error', message: e.message });
  }
}
