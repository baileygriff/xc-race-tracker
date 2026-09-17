# XC Race Tracker

Phone-friendly timing for a cross country meet. Two volunteers, one Google Sheet, results within minutes.

- **Timer** presses LAP as each runner crosses the line.
- **Finishers** taps each bib number in chute order.
- The sheet lines the lists up by position, looks up names and teams, and scores the meet.
- **Run two of each.** Two timers and two finish loggers can work the same race. Times are averaged;
  two timers more than a second apart on the same position, two loggers naming different bibs, or
  lists of different lengths are flagged in the Results tab and in the app.

Everything is saved on the phone at every tap. Sending is optional and can be repeated: a re-send
replaces the earlier data for that race and job. If there is no signal, **Copy results** gives a text
you can send to the scorer, who pastes it into the sheet.

The two apps never depend on each other. If one phone dies, the other list is still intact.

## One-time setup (about 20 minutes)

### 1. The sheet and script
1. Create a blank Google Sheet. **Extensions → Apps Script.** Delete the sample code, paste
   `apps-script/Code.gs`, save.
2. Run `setup` (pick it in the function dropdown, press ▶). Approve the permissions prompt.
3. Back in the sheet, open the **Config** tab and set a `passcode` (volunteers) and a `coach_code`
   (coaches). Everything else about the meet is set from the app in the next step.
4. **Deploy → New deployment → type: Web app.** Execute as **Me**, who has access **Anyone**.
   Copy the URL ending in `/exec`. That is the endpoint the phones talk to.
   (Any later edit to the script needs **Deploy → Manage deployments → edit → New version**.)

### 2. The meet
Open the app's **Meet setup** page (link at the bottom of the home screen, or
`index.html?page=setup&endpoint=...&key=<passcode>`). Enter the races and the list of teams, and
change the codes if you like. Coaches then pick their team from that list. The page also shows how
many runners each team has submitted per race.

### 3. The roster
Send coaches the roster link:

```
https://<your-host>/index.html?page=roster&endpoint=https://script.google.com/macros/s/.../exec&code=<coach_code>
```

They pick their team and race, and paste their list from wherever they keep it (a
spreadsheet column, a text, `Name, grade` lines). The page shows what it understood in an editable
table, highlights anything doubtful, and on submit the sheet assigns bibs and shows them straight
back. Re-submitting replaces that team's list for the race and keeps bibs already assigned.

Bibs are chosen so any two differ in at least two digits, so a misread digit can't become another
runner. Print them from the **Roster** tab. To add a runner by hand, add a Roster row with the bib
blank and run `assignBibs` in the script editor.

### 4. The phones
Host the folder anywhere static (GitHub Pages is free; see below) and text each volunteer a link
with their job baked in:

```
https://<your-host>/index.html?endpoint=https://script.google.com/macros/s/.../exec&key=<passcode>
```
(`&race=Boys&device=Sam&mode=timer` can be added to pre-fill those too.)

On the phone: open the link once **while online**, then **Share → Add to Home Screen** (iPhone) or
the browser's **Install app / Add to Home screen** (Android). From then on it opens without signal.
The home screen picks the race and the volunteer's name; ⚙ holds the endpoint and passcode. Each
race's taps are kept separately, so switching races between heats loses nothing.

## Race day
1. Every volunteer opens the app, picks the race and types their name (it labels their data in the
   sheet, so two timers must use different names). Finish loggers tap **Reload bib list** while there
   is signal; bibs are kept on the phone after that.
2. Gun: Timer presses **START RACE**. From then on, only **LAP**, once per runner crossing the line.
   After the last runner, **Finish race** stops the clock.
3. In the chute, Finishers taps each bib as the runner passes. Runner with no bib → the orange
   button, and write down who it was. Misclick → **Undo last** (tap twice).
4. **Corrections:** tap any entry in the list to change it, insert one before or after it, or delete
   it. Everything after the change shifts automatically.
5. After the last runner: everyone presses **Send to sheet**. The reply says what the sheet now has
   and lists anything that disagrees. Fix it on the phone and send again; a re-send replaces only
   that phone's earlier data. Then ‹ Home, pick the next race, repeat.
6. Results: **Results** in the app, or the **Results** and **TeamScores** tabs in the sheet. Flagged
   rows are the ones to look at before announcing.

Scoring follows the standard rule: only teams with five or more finishers score, places are
renumbered among those runners only, the score is the sum of the first five, and a tie goes to the
better sixth runner.

### If the counts don't match
One list has a dropped or doubled entry and everything after it is shifted by one. With two timers
and two loggers, the flags show exactly where the lists start disagreeing. Fix the entry on the phone
(tap it in the list, insert or delete) and press Send again. Keep a paper backup in the chute this
first time regardless.

## Hosting on GitHub Pages
```bash
gh repo create xc-race-tracker --public --source=. --push
gh api -X POST repos/{owner}/xc-race-tracker/pages -f 'source[branch]=main' -f 'source[path]=/'
```
The site is then at `https://<user>.github.io/xc-race-tracker/index.html`. Any push updates it.

## Development
```bash
node dev/server.js               # full local demo: the app + a stand-in Google Sheet, seeded roster
node test/backend.test.js        # scoring, bib assignment and re-send behaviour, no Google needed
```
The demo server prints ready-made Timer and Finishers links and a `/sheet` page that shows what
the real script would write to every tab. It runs the actual `Code.gs`, so what you see there is
what the real sheet will do.
