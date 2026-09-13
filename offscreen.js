let locationInProgress = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'GET_LOCATION') return;
  if (locationInProgress) return;

  console.log('[Offscreen] Got GET_LOCATION request');
  locationInProgress = true;

  const send = (lat, lng) => {
    locationInProgress = false;
    chrome.runtime.sendMessage({ type: 'LOCATION_RESULT', lat, lng });
  };

  const fail = (errMsg) => {
    locationInProgress = false;
    chrome.runtime.sendMessage({ type: 'LOCATION_RESULT', error: errMsg });
  };

  // Single attempt with generous timeout
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      console.log('[Offscreen] Got position:', pos.coords.latitude, pos.coords.longitude);
      send(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      console.error('[Offscreen] Error code:', err.code, err.message);
      if (err.code === 1) {
        fail('PERMISSION_DENIED');
      } else if (err.code === 2) {
        fail('POSITION_UNAVAILABLE');
      } else {
        // code 3 = timeout — retry once with higher accuracy off and longer timeout
        console.warn('[Offscreen] Timeout, retrying once...');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            console.log('[Offscreen] Retry succeeded');
            send(pos.coords.latitude, pos.coords.longitude);
          },
          (err2) => {
            console.error('[Offscreen] Retry also failed:', err2.code);
            fail('TIMEOUT');
          },
          { enableHighAccuracy: false, timeout: 30000, maximumAge: 600000 }
        );
      }
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
});
