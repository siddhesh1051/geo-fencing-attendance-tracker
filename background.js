const OFFICE_LAT = 12.93725;
const OFFICE_LNG = 77.610268;
const OFFICE_RADIUS_M = 200;
const CHECK_HOUR_START = 7;
const CHECK_HOUR_END = 19;
const CHECK_INTERVAL_MIN = 30;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isWeekend() { return new Date().getDay() % 6 === 0; }
function isInWindow() {
  const h = new Date().getHours();
  return h >= CHECK_HOUR_START && h < CHECK_HOUR_END;
}

async function getStoredData() {
  return new Promise(resolve => {
    chrome.storage.local.get(['attendance'], r => resolve(r.attendance || {}));
  });
}

async function saveStatus(key, status) {
  const data = await getStoredData();
  data[key] = { status, timestamp: new Date().toISOString() };
  return new Promise(resolve => chrome.storage.local.set({ attendance: data }, resolve));
}

// Keep offscreen doc alive — only close if truly gone
async function ensureOffscreen() {
  try {
    // Always close and recreate — fixes Sonoma geolocation cache bug
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      await chrome.offscreen.closeDocument();
    }
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['GEOLOCATION'],
      justification: 'Detect office location for attendance tracking'
    });
    // Give it 800ms to fully initialize
    await new Promise(r => setTimeout(r, 800));
  } catch (err) {
    throw err;
  }
}

function getLocation() {
  return new Promise(async (resolve, reject) => {
    const TIMEOUT_MS = 40000;

    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('Geolocation timeout — Chrome may need location permission'));
    }, TIMEOUT_MS);

    function handler(msg) {
      if (msg.type !== 'LOCATION_RESULT') return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(handler);
      if (msg.error) reject(new Error(msg.error));
      else resolve({ lat: msg.lat, lng: msg.lng });
    }

    chrome.runtime.onMessage.addListener(handler);

    try {
      await ensureOffscreen();
      // Send to offscreen — use tabs messaging workaround for reliability
      await chrome.runtime.sendMessage({ type: 'GET_LOCATION' });
    } catch (err) {
      // sendMessage throws if no receivers — offscreen may not be ready yet
      // Wait and retry once
      await new Promise(r => setTimeout(r, 1000));
      try {
        await chrome.runtime.sendMessage({ type: 'GET_LOCATION' });
      } catch (e) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('Could not reach offscreen document: ' + e.message));
      }
    }
  });
}

async function checkAndMark() {

  if (isWeekend()) { console.log('[Attendance] Weekend, skip'); return; }
  if (isMandatoryHoliday(todayKey())) { console.log('[Attendance] Mandatory holiday, skip'); return; }
  if (!isInWindow()) { console.log('[Attendance] Outside window, skip'); return; }

  const today = todayKey();
  const data = await getStoredData();
  const todayEntry = data[today];

  if (todayEntry?.status === 'present') { console.log('[Attendance] Already present'); return; }
  if (todayEntry?.status === 'leave')   { console.log('[Attendance] Already leave');   return; }

  try {
    const { lat, lng } = await getLocation();
    const dist = haversineDistance(lat, lng, OFFICE_LAT, OFFICE_LNG);

    if (dist <= OFFICE_RADIUS_M) {
      await saveStatus(today, 'present');
      chrome.notifications.create('att-' + Date.now(), {
        type: 'basic', iconUrl: 'icon48.png',
        title: 'Attendance Tracker',
        message: `Marked: Present ✓  ${new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'})}`
      });
    } else {
      const alreadyWFH = todayEntry?.status === 'wfh';
      if (!alreadyWFH) {
        await saveStatus(today, 'wfh');
        chrome.notifications.create('att-' + Date.now(), {
          type: 'basic', iconUrl: 'icon48.png',
          title: 'Attendance Tracker',
          message: `Marked: WFH  ${new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'})}`
        });
      }
    }
  } catch (err) {
    // Show notification so user knows
    let errMsg = err.message;
    if (err.message === 'PERMISSION_DENIED') {
      errMsg = 'Location denied — go to System Settings → Privacy & Security → Location Services → enable Chrome';
    } else if (err.message === 'TIMEOUT') {
      errMsg = 'Location timed out — ensure Chrome has Location access in macOS System Settings';
    }
    chrome.notifications.create('att-err-' + Date.now(), {
      type: 'basic', iconUrl: 'icon48.png',
      title: 'Attendance Tracker — Location Error',
      message: errMsg
    });
  }
}


// Mandatory holidays — skipped entirely (not marked, not counted)
const RZP_MANDATORY_HOLIDAYS = {
  '2026-01-01':'New Year','2026-01-26':'Republic Day','2026-03-04':'Holi',
  '2026-03-19':'Ugadi','2026-05-01':'May Day','2026-08-28':'Raksha Bandhan',
  '2026-09-14':'Ganesh Chaturthi','2026-10-02':'Gandhi Jayanti',
  '2026-10-21':'Dussehra','2026-11-09':'Diwali','2026-12-25':'Christmas'
};
function isMandatoryHoliday(dateStr) { return !!RZP_MANDATORY_HOLIDAYS[dateStr]; }

chrome.runtime.onStartup.addListener(() => {
  checkAndMark();
});

chrome.runtime.onInstalled.addListener(() => {
  // Request notification permission
  chrome.notifications.create('att-welcome', {
    type: 'basic', iconUrl: 'icon48.png',
    title: 'Attendance Tracker Active',
    message: 'Auto-tracking your attendance. You will be notified when marked.'
  });
  chrome.alarms.clearAll(() => {
    chrome.alarms.create('attendance-check', {
      delayInMinutes: 1,
      periodInMinutes: CHECK_INTERVAL_MIN
    });
  });
  checkAndMark();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'attendance-check') {
    checkAndMark();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'markLeave') {
    saveStatus(todayKey(), 'leave').then(() => {
      chrome.notifications.create('att-' + Date.now(), {
        type: 'basic', iconUrl: 'icon48.png',
        title: 'Attendance Tracker', message: `Marked: Leave for ${todayKey()}`
      });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.action === 'markWFH') {
    saveStatus(todayKey(), 'wfh').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'markPresent') {
    saveStatus(todayKey(), 'present').then(() => sendResponse({ ok: true }));
    return true;
  }

});
