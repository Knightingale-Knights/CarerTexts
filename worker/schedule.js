const { MIN, zonedToUtc } = require('../lib/time');

// Jobs for one shift. `at` is when the text is due, `until` is the last moment it is still worth sending.
//  checkin   15 min before start
//  checkout  at shift end
//  notes_1   10pm on the shift day      (skipped if that is before the shift has ended)
//  notes_2   10am the day after
//  notes_3   8pm the day after
function jobsFor(win, tz) {
  const jobs = [
    { kind: 'checkin', at: win.start - 15 * MIN, until: win.start },
    { kind: 'checkout', at: win.end, until: win.end + 3 * 60 * MIN },
  ];
  const notes = [
    ['notes_1', zonedToUtc(win.y, win.m, win.d, 22, 0, tz)],
    ['notes_2', zonedToUtc(win.y, win.m, win.d + 1, 10, 0, tz)],
    ['notes_3', zonedToUtc(win.y, win.m, win.d + 1, 20, 0, tz)],
  ];
  for (const [kind, at] of notes) {
    if (at >= win.end + 30 * MIN) jobs.push({ kind, at, until: at + 2 * 60 * MIN });
  }
  return jobs;
}

function dueJobs(win, nowMs, tz) {
  return jobsFor(win, tz).filter((j) => nowMs >= j.at && nowMs < j.until);
}

// Link expiry (unix seconds) for each link kind.
function linkExpirySec(kind, win) {
  return Math.floor((kind === 'in' ? win.start + 6 * 60 * MIN : win.end + 24 * 60 * MIN) / 1000);
}

module.exports = { jobsFor, dueJobs, linkExpirySec };
