// Mandatory holidays — treated like weekends (greyed, excluded from workday count)
const RZP_MANDATORY_HOLIDAYS = {
  '2026-01-01':'New Year','2026-01-26':'Republic Day','2026-03-04':'Holi',
  '2026-03-19':'Ugadi','2026-05-01':'May Day','2026-08-28':'Raksha Bandhan',
  '2026-09-14':'Ganesh Chaturthi','2026-10-02':'Gandhi Jayanti',
  '2026-10-21':'Dussehra','2026-11-09':'Diwali','2026-12-25':'Christmas'
};
// Optional holidays — shown with emoji but still counted as workdays
const RZP_OPTIONAL_HOLIDAYS = {
  '2026-01-15':'Makara Sankranti','2026-02-19':'Shivaji Jayanti',
  '2026-04-03':'Good Friday','2026-05-28':'Eid al Adha',
  '2026-08-26':'Onam','2026-09-04':'Janmashtami','2026-10-20':'Durga Puja'
};
function isMandatoryHoliday(k) { return !!RZP_MANDATORY_HOLIDAYS[k]; }
function isOptionalHoliday(k) { return !!RZP_OPTIONAL_HOLIDAYS[k]; }

// Razorpay 2026 Mandatory Holidays (auto-marked as leave)
const MANDATORY_HOLIDAYS = {
  '2026-01-01': 'New Year',
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Holi',
  '2026-05-01': 'May Day / Buddha Pournima',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-21': 'Dussehra / Vijaya Dashami',
  '2026-11-09': 'Diwali',
  '2026-12-25': 'Christmas'
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDateKey = null;
let attendanceTarget = 60;

function todayKey() {
  return dateKey(today.getFullYear(), today.getMonth(), today.getDate());
}
function dateKey(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function isWeekend(y, m, d) {
  return new Date(y, m, d).getDay() % 6 === 0;
}
function daysInMonth(y, m) {
  return new Date(y, m+1, 0).getDate();
}
function isFuture(y, m, d) {
  return new Date(y, m, d) > today;
}
function officeDaysNeededForTarget(present, eligible, targetFrac) {
  if (eligible <= 0 || (present / eligible) >= targetFrac) return 0;
  if (targetFrac >= 1) return Infinity;
  return Math.ceil(((targetFrac * eligible) - present) / (1 - targetFrac) - Number.EPSILON);
}

function showToast(msg, color = '#4ade80') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.color = color;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function loadAndRender() {
  chrome.storage.local.get(['attendance', 'attendanceTarget'], (r) => {
    attendanceTarget = r.attendanceTarget || 60;
    document.getElementById('target-pct').value = attendanceTarget;
    render(r.attendance || {});
  });
}

function render(data) {
  document.getElementById('date-str').textContent = today.toLocaleDateString('en-IN', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  });

  // Check notification permission
  if (Notification.permission !== 'granted') {
    chrome.storage.local.get(['notifBannerDismissed'], (r) => {
      if (!r.notifBannerDismissed) {
        document.getElementById('notif-banner').style.display = 'block';
      }
    });
  }

  // Today card
  const tk = todayKey();
  const todayEntry = data[tk];
  const statusEl = document.getElementById('today-status');
  const timeEl = document.getElementById('today-time');
  if (todayEntry) {
    statusEl.textContent = todayEntry.status.toUpperCase();
    statusEl.className = 'today-status s-' + todayEntry.status;
    timeEl.textContent = 'logged at ' + new Date(todayEntry.timestamp).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  } else {
    statusEl.textContent = 'NOT SET';
    statusEl.className = 'today-status s-unset';
    timeEl.textContent = '';
  }

  // Month stats
  const y = viewYear, m = viewMonth;
  const dim = daysInMonth(y, m);
  let present=0, wfh=0, leave=0, workdays=0;
  for (let d=1; d<=dim; d++) {
    const dk = dateKey(y,m,d);
    if (!isWeekend(y,m,d) && !isMandatoryHoliday(dk)) {
      workdays++;
      const e = data[dk];
      if (e?.status === 'present') present++;
      else if (e?.status === 'wfh') wfh++;
      else if (e?.status === 'leave') leave++;
    }
  }

  document.getElementById('s-present').textContent = present;
  document.getElementById('s-wfh').textContent = wfh;
  document.getElementById('s-leave').textContent = leave;

  // Count elapsed workdays only (up to and including today)
  let elapsedWorkdays = 0;
  const isCurrentMonth = y === today.getFullYear() && m === today.getMonth();
  for (let d=1; d<=dim; d++) {
    const dk2 = dateKey(y,m,d);
    const pastOrToday = !isCurrentMonth || new Date(y,m,d) <= today;
    if (!isWeekend(y,m,d) && !isMandatoryHoliday(dk2) && pastOrToday) {
      elapsedWorkdays++;
    }
  }
  // For past months use full workdays, for current month use elapsed
  const denominator = isCurrentMonth ? elapsedWorkdays - leave : workdays - leave;
  const eligible = denominator;
  const pct = eligible > 0 ? Math.round((present / eligible) * 100) : 0;
  const fill = document.getElementById('prog-fill');
  fill.style.width = Math.min(pct, 100) + '%';
  const targetFrac = attendanceTarget / 100;
  fill.style.background = pct >= attendanceTarget ? '#4ade80' : pct >= (attendanceTarget - 10) ? '#fbbf24' : '#f87171';
  document.getElementById('prog-pct').textContent = eligible > 0 ? `${pct}%  ${present}/${eligible}` : '—';

  // Update the progress bar marker position to match target
  const marker = document.querySelector('.prog-marker');
  if (marker) marker.style.left = attendanceTarget + '%';

  const needed = officeDaysNeededForTarget(present, eligible, targetFrac);
  const noteEl = document.getElementById('prog-note');
  let msg;
  if (eligible === 0) {
    msg = '📅 No data';
  } else if (pct >= attendanceTarget) {
    msg = `✅ On target`;
  } else if (Number.isFinite(needed)) {
    msg = `🎯 Need ${needed} day${needed !== 1 ? 's' : ''} for ${attendanceTarget}%`;
  } else {
    msg = `⚠️ Not reachable for ${attendanceTarget}%`;
  }
  noteEl.textContent = msg;

  renderCalendar(data, y, m);
}

function renderCalendar(data, y, m) {
  document.getElementById('cal-title').textContent = `${MONTHS[m]} ${y}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  // Day of week headers
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'cal-dow' + (i===0||i===6 ? ' weekend' : '');
    el.textContent = d;
    grid.appendChild(el);
  });

  const fdow = new Date(y, m, 1).getDay();
  for (let i=0; i<fdow; i++) {
    grid.appendChild(Object.assign(document.createElement('div'), { className: 'cal-day empty' }));
  }

  const dim = daysInMonth(y, m);
  for (let d=1; d<=dim; d++) {
    const el = document.createElement('div');
    const wknd = isWeekend(y, m, d);
    const isToday = y===today.getFullYear() && m===today.getMonth() && d===today.getDate();
    const future = isFuture(y, m, d);
    const entry = data[dateKey(y, m, d)];
    const status = entry?.status;

    const dk = dateKey(y, m, d);
    const isHoliday = !status && MANDATORY_HOLIDAYS[dk];
    let classes = 'cal-day';
    if (wknd) classes += ' weekend';
    if (isToday) classes += ' today';
    if (future && !isHoliday && !status) classes += ' future';
    if (status) classes += ' d-' + status;
    el.className = classes;

    const num = document.createElement('div');
    num.className = 'd-num';
    num.textContent = d;
    el.appendChild(num);



    // Click to edit — any non-weekend, non-holiday day
    if (!wknd && !isHoliday) {
      el.addEventListener('click', () => openModal(y, m, d, entry));
    }

    grid.appendChild(el);
  }
}

function openModal(y, m, d, entry) {
  selectedDateKey = dateKey(y, m, d);
  const dateObj = new Date(y, m, d);
  const future = isFuture(y, m, d);
  const dk = dateKey(y, m, d);
  const holidayName = RZP_OPTIONAL_HOLIDAYS[dk];
  document.getElementById('modal-date').textContent = dateObj.toLocaleDateString('en-IN', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  }) + (entry ? `  —  ${entry.status}` : '') + (future && !holidayName ? '  (future)' : '');

  // For future dates: only show leave + clear
  document.getElementById('modal-present').style.display = future ? 'none' : 'block';
  document.getElementById('modal-wfh').style.display = future ? 'none' : 'block';
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  selectedDateKey = null;
}

function setDayStatus(status) {
  if (!selectedDateKey) return;
  chrome.storage.local.get(['attendance'], (r) => {
    const data = r.attendance || {};
    if (status === 'clear') {
      delete data[selectedDateKey];
    } else {
      data[selectedDateKey] = { status, timestamp: new Date().toISOString() };
    }
    chrome.storage.local.set({ attendance: data }, () => {
      showToast(status === 'clear' ? 'Entry cleared' : `Marked: ${status.toUpperCase()}`);
      closeModal();
      setTimeout(loadAndRender, 200);
    });
  });
}

function override(status) {
  const action = status === 'present' ? 'markPresent' : status === 'wfh' ? 'markWFH' : 'markLeave';
  chrome.runtime.sendMessage({ action }, () => {
    showToast('Marked: ' + status.toUpperCase());
    setTimeout(loadAndRender, 300);
  });
}

function clearToday() {
  chrome.storage.local.get(['attendance'], (r) => {
    const data = r.attendance || {};
    delete data[todayKey()];
    chrome.storage.local.set({ attendance: data }, () => {
      showToast('Today cleared', '#888');
      setTimeout(loadAndRender, 200);
    });
  });
}

function exportCSV() {
  chrome.storage.local.get(['attendance'], (r) => {
    const data = r.attendance || {};
    const rows = Object.entries(data)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([date, entry]) => `${date},${entry.status}`)
      .join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'attendance.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported attendance.csv');
  });
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.trim().split('\n');
    let imported = 0, skipped = 0;
    chrome.storage.local.get(['attendance'], (r) => {
      const data = r.attendance || {};
      lines.forEach(line => {
        const parts = line.trim().split(',');
        if (parts.length < 2) { skipped++; return; }
        const date = parts[0].trim();
        const status = parts[1].trim().toLowerCase();
        if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) { skipped++; return; }
        if (!['present','wfh','leave'].includes(status)) { skipped++; return; }
        data[date] = { status, timestamp: data[date]?.timestamp || new Date().toISOString() };
        imported++;
      });
      chrome.storage.local.set({ attendance: data }, () => {
        showToast(`Imported ${imported} days${skipped ? `, skipped ${skipped}` : ''}`);
        setTimeout(loadAndRender, 300);
      });
    });
  };
  reader.readAsText(file);
}

function checkLocationAccess() {
  chrome.storage.local.get(['locBannerDismissed'], (r) => {
    if (r.locBannerDismissed) return;
    navigator.geolocation.getCurrentPosition(
      () => { /* location works, no banner needed */ },
      () => {
        document.getElementById('loc-banner').style.display = 'block';
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();

  // Notification enable button
  document.getElementById('notif-enable').addEventListener('click', () => {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        document.getElementById('notif-banner').style.display = 'none';
        showToast('Notifications enabled ✓');
      } else {
        chrome.tabs.create({ url: 'chrome://settings/content/notifications' });
      }
    });
  });

  // Dismiss banner
  document.getElementById('notif-close').addEventListener('click', () => {
    document.getElementById('notif-banner').style.display = 'none';
    chrome.storage.local.set({ notifBannerDismissed: true });
  });

  // Target percentage setting
  document.getElementById('target-pct').addEventListener('change', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 10) val = 10;
    if (val > 100) val = 100;
    e.target.value = val;
    attendanceTarget = val;
    chrome.storage.local.set({ attendanceTarget: val }, () => {
      showToast(`Target set to ${val}%`);
      loadAndRender();
    });
  });

  // Location access test
  checkLocationAccess();
  document.getElementById('loc-test').addEventListener('click', () => {
    const btn = document.getElementById('loc-test');
    btn.textContent = 'Testing...';
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      () => {
        document.getElementById('loc-banner').style.display = 'none';
        chrome.storage.local.set({ locBannerDismissed: true });
        showToast('Location access working');
        btn.textContent = 'Test Location Access';
        btn.disabled = false;
      },
      (err) => {
        btn.textContent = 'Test Location Access';
        btn.disabled = false;
        if (err.code === 1) {
          showToast('Location denied — enable in System Settings', '#f87171');
        } else {
          showToast('Location failed — check System Settings', '#f87171');
        }
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });
  document.getElementById('loc-close').addEventListener('click', () => {
    document.getElementById('loc-banner').style.display = 'none';
    chrome.storage.local.set({ locBannerDismissed: true });
  });

  // Month nav
  document.getElementById('prev-month').addEventListener('click', () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } loadAndRender();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } loadAndRender();
  });

  // Today overrides
  document.getElementById('btn-present').addEventListener('click', () => override('present'));
  document.getElementById('btn-wfh').addEventListener('click', () => override('wfh'));
  document.getElementById('btn-leave').addEventListener('click', () => override('leave'));
  document.getElementById('btn-clear').addEventListener('click', clearToday);



  // Modal buttons
  document.getElementById('modal-present').addEventListener('click', () => setDayStatus('present'));
  document.getElementById('modal-wfh').addEventListener('click', () => setDayStatus('wfh'));
  document.getElementById('modal-leave').addEventListener('click', () => setDayStatus('leave'));
  document.getElementById('modal-clear').addEventListener('click', () => setDayStatus('clear'));
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportCSV);


  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
  document.getElementById('file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importCSV(file);
    e.target.value = '';
  });
});
