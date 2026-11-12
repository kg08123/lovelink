// Shared GPS + IP location detection, used by onboarding and by the
// Discover location banner. One copy only — both pages get the same
// robust flow:
//   1. GPS, 15s, accepts positions up to 60s old.
//   2. On timeout/unavailable (codes 2/3) ONE retry: 30s, accepts any
//      cached position (maximumAge Infinity) — a slow first fix on a
//      phone often succeeds on the second call.
//   3. If GPS still fails, AUTOMATIC IP detection (ipwho.is, then
//      ipapi.co) and the approximate location is used.
//   Denied (code 1) rejects at once — the caller shows the
//   allow-instructions message, unchanged. Only when GPS AND IP both
//   fail does the caller show an error.
// The Nominatim city-cleaning logic is unchanged from onboarding.
(function () {
  'use strict';

  // Nominatim address -> city name. For Ethiopian coords it often returns
  // no "city" at all (Addis: suburb/county/state only, Amharic script),
  // or "ሀዋሳ / Hawassa" (Amharic + Latin). Prefer the Latin part, map
  // known Amharic names, never return a district like "Kirkos" as the city.
  var AM_CITY = {'አዲስ አበባ':'Addis Ababa','ሀዋሳ':'Hawassa','መቀሌ':'Mekelle','ባሕር ዳር':'Bahir Dar','ድሬዳዋ':'Dire Dawa','አዳማ':'Adama','ጅማ':'Jimma','ጎንደር':'Gondar','ደሴ':'Dessie','ጅጅጋ':'Jijiga','አርባ ምንጭ':'Arba Minch','ሐረር':'Harar','ነቀምት':'Nekemte','አሶሳ':'Asosa','ጋምቤላ':'Gambela','ሰመራ':'Semera'};
  function cleanCity(s) {
    if (!s) return '';
    var v = String(s).trim();
    if (AM_CITY[v]) return AM_CITY[v];
    var parts = v.split('/');
    var latin = parts[parts.length - 1].trim();
    if (AM_CITY[latin]) return AM_CITY[latin];
    if (!/[A-Za-z]/.test(latin)) return '';
    return latin;
  }
  function cityFromAddress(a) {
    if (!a) return '';
    var c = cleanCity(a.city) || cleanCity(a.town) || cleanCity(a.municipality) || cleanCity(a.village);
    if (c) return c;
    return cleanCity(a.state) || cleanCity(a.state_district) || '';
  }
  function readCityName(lat, lng) {
    // zoom=10 asks for city-level results; accept-language=en prefers
    // Latin names where OpenStreetMap has them.
    return fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&zoom=10&accept-language=en')
      .then(function (r) { return r.json(); })
      .then(function (d) { return cityFromAddress(d.address || {}); });
  }

  function gpsOnce(options) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject({ code: 0 });
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }, function (err) { reject(err || { code: 0 }); }, options);
    });
  }

  // Detect the city from the internet connection (approximate). ipwho.is
  // is free, no key, and allows browser (CORS) calls; ipapi.co is the
  // second try. Resolves {lat, lng, city}; rejects when both fail.
  function detectIP() {
    return fetch('https://ipwho.is/')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success && d.city && d.latitude) return { lat: d.latitude, lng: d.longitude, city: d.city };
        throw new Error('ipwho: no city');
      })
      .catch(function () {
        return fetch('https://ipapi.co/json/')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.city && d.latitude) return { lat: d.latitude, lng: d.longitude, city: d.city };
            throw new Error('ipapi: no city');
          });
      });
  }

  // Robust detection. Resolves {lat, lng, city, approx, via} where via is
  // 'gps', 'gps-retry' or 'ip'. city may be '' when the GPS fix succeeded
  // but the city name could not be read (caller decides the message).
  // Rejects {code:1} when the user denied permission, {code:0} when
  // GPS (both tries) AND IP detection all failed.
  function detectWithFallback() {
    return gpsOnce({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 })
      .then(function (p) { return { lat: p.lat, lng: p.lng, via: 'gps' }; })
      .catch(function (err) {
        if (err && err.code === 1) throw err;
        return gpsOnce({ enableHighAccuracy: false, timeout: 30000, maximumAge: Infinity })
          .then(function (p) { return { lat: p.lat, lng: p.lng, via: 'gps-retry' }; })
          .catch(function (err2) {
            if (err2 && err2.code === 1) throw err2;
            return detectIP().then(function (ip) {
              return { lat: ip.lat, lng: ip.lng, city: ip.city, approx: true, via: 'ip' };
            });
          });
      })
      .then(function (res) {
        if (res.city) return res; // IP path already carries a city.
        return readCityName(res.lat, res.lng).then(function (city) {
          res.city = city || '';
          return res;
        }).catch(function () { res.city = ''; return res; });
      });
  }

  window.LoveLinkLocation = {
    detectWithFallback: detectWithFallback,
    detectIP: detectIP,
    readCityName: readCityName,
  };
})();
