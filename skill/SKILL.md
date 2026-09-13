---
name: razor-attendance
description: >
  Query and analyze attendance data from the Razor Attendance Tracker Chrome extension.
  Use this skill whenever the user asks about their office attendance — things like
  "how many days was I in office this month", "what's my attendance percentage",
  "show me my WFH days", "am I on track for 60%", "attendance summary",
  "how many leaves did I take", "weekly attendance", "compare this month to last month",
  or any question about present/WFH/leave status. Also use when the user mentions
  "attendance tracker", "razor attendance", or wants to know their office vs WFH ratio.
  Even casual questions like "was I in office on Tuesday" or "did I take leave last week"
  should trigger this skill.
---

# Razor Attendance Tracker — Data Skill

You are helping a user query their attendance data from the Razor Attendance Tracker Chrome extension. This extension automatically tracks office attendance using GPS geofencing and stores everything locally in Chrome's extension storage.

## How the Extension Works

Understanding the system helps you answer questions accurately:

- **Geofencing**: Two office locations in Bangalore (Razorpay), 100m radius each
- **Check window**: 7 AM – 7 PM, every 30 minutes via Chrome alarms
- **Statuses**:
  - **Present** — user was within 100m of an office location. Sticky: once marked, stays for the day
  - **WFH** — user was detected outside office radius. Can be upgraded to Present if user arrives at office later
  - **Leave** — only set manually by the user. Sticky: auto-checks skip the day entirely
- **Skipped days**: Weekends (Sat/Sun) and mandatory holidays are never checked or counted
- **Mandatory holidays (2026)**: New Year, Republic Day, Holi, Ugadi, May Day, Raksha Bandhan, Ganesh Chaturthi, Gandhi Jayanti, Dussehra, Diwali, Christmas

### Attendance % Formula

```
attendance% = present / (workdays - leave) × 100
```

- Only **Present** counts toward the percentage
- **WFH** does NOT count as office attendance
- **Leave** days are excluded from the denominator (taking leave doesn't hurt your %)
- Weekends and mandatory holidays are excluded from workday count
- The denominator uses total month workdays (not just elapsed days)

### "Need X days" Formula

```
needed = ceil(target% × eligible) - present
```
Where `eligible = workdays - leave`. If `needed > eligible - present`, the target is unreachable.

## Step 1: Find the Data

The extension stores data in Chrome's LevelDB at:
```
~/Library/Application Support/Google/Chrome/<Profile>/Local Extension Settings/<extension-id>/
```

The profile name and extension ID vary per machine. Auto-discover it by searching for files containing attendance status data:

```bash
find "$HOME/Library/Application Support/Google/Chrome" -path "*/Local Extension Settings/*" -name "LOG" 2>/dev/null | while read f; do
  d=$(dirname "$f")
  if strings "$d"/* 2>/dev/null | grep -q '"status":"present"'; then
    echo "$d"
    break
  fi
done
```

**On Linux**, replace the base path with `~/.config/google-chrome`.
**On Windows**, use `%LOCALAPPDATA%\Google\Chrome\User Data`.

If the search finds nothing, ask the user:
1. "Is the Razor Attendance Tracker extension installed and do you have any attendance data marked?"
2. "Which Chrome profile do you use? (check chrome://version for the profile path)"
3. "What's your extension ID? (visible at chrome://extensions)"

Then construct the path manually.

## Step 2: Read the Data

Extract the latest attendance JSON from LevelDB:

```bash
DIR="<discovered-path>"
find "$DIR" -type f -exec strings {} \; 2>/dev/null | grep '"status"' | tail -1 | sed 's/^[^{]*//' | sed 's/[^}]*$//'
```

This gives the last (most current) attendance object. It looks like:
```json
{
  "2026-09-01": {"status": "present", "timestamp": "2026-09-01T10:30:00.000Z"},
  "2026-09-02": {"status": "wfh", "timestamp": "2026-09-02T09:15:00.000Z"},
  "2026-09-03": {"status": "leave", "timestamp": "2026-09-03T08:00:00.000Z"}
}
```

If the extracted string has junk characters at the start or end, clean them — find the first `{` and last `}` to isolate the JSON.

## Step 3: Analyze and Answer

Parse the JSON and compute whatever the user asked for. Common analyses:

### Monthly Summary
For a given month, count present/wfh/leave days. Only count weekdays (Mon-Fri) that aren't mandatory holidays. Calculate attendance % using the formula above.

### Weekly Summary
Group by calendar week (Sun-Sat). For each week, compute `present / (weekday_count - leave)`.

### Trends
Compare month-over-month attendance %. Identify best/worst months, streaks, patterns (e.g., "you tend to WFH on Fridays").

### Projections
If the user asks "am I on track" or "how many more days do I need", use the "Need X days" formula with their target (default 60%).

### Day Lookups
For questions like "was I in office on Sep 5", just look up the date key in the data.

## Mandatory Holidays (2026)

These are excluded from workday counts:
- Jan 1 (New Year), Jan 26 (Republic Day)
- Mar 4 (Holi), Mar 19 (Ugadi)
- May 1 (May Day)
- Aug 28 (Raksha Bandhan)
- Sep 14 (Ganesh Chaturthi)
- Oct 2 (Gandhi Jayanti), Oct 21 (Dussehra)
- Nov 9 (Diwali)
- Dec 25 (Christmas)

## Response Style

- Present data in clean tables when showing multi-day or multi-month summaries
- For simple lookups ("was I in office Monday"), just give a direct answer
- Always show the formula inputs when reporting attendance % (e.g., "12 present out of 18 eligible = 67%")
- If the data looks sparse or has gaps, mention it — the user may have forgotten to open Chrome some days
- Use the user's target percentage (default 60%) when discussing whether they're on track

