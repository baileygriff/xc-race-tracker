# XC Race Tracker

Phone-friendly timing for a cross country meet. Two volunteers, one Google Sheet, results within minutes.

- **Timer** presses LAP as each runner crosses the line.
- **Finishers** taps each bib number in chute order.
- The sheet lines the two lists up by position, looks up names and teams, and scores the meet.

Everything is saved on the phone at every tap. Sending is optional and can be repeated: a re-send
replaces the earlier data for that race and job. If there is no signal, **Copy results** gives a text
you can send to the scorer, who pastes it into the sheet.

The two apps never depend on each other. If one phone dies, the other list is still intact.

## One-time setup (about 20 minutes)

### 1. The sheet and script
1. Create a blank Google Sheet. **Extensions → Apps Script.** Delete the sample code, paste
   `apps-script/Code.gs`, save.
2. Run `setup` (pick it in the function dropdown, press ▶). Approve the permissions prompt.
3. Back in the sheet, open the **Config** tab and set `races` (comma separated), e.g.
   `Boys, Girls`. **The race names must match exactly what the volunteers type in the app.**
4. Run `createRosterForm`. The coach form link appears in Config as `form_url`. Send it to coaches.
5. **Deploy → New deployment → type: Web app.** Execute as **Me**, who has access **Anyone**.
   Copy the URL ending in `/exec`. That is the endpoint the phones talk to.
   (Any later edit to the script needs **Deploy → Manage deployments → edit → New version**.)

### 2. The roster
Coaches submit one form per team per race, one runner per line (`Name, grade`).
When they are in: run `importRoster`. It fills the **Roster** tab and assigns every runner a 3-digit
bib. Bibs are chosen so any two differ in at least two digits, so a misread digit can't become
another runner. Print the bibs from the Roster tab. Run `importRoster` again any time; it only adds
new runners and never changes a bib already assigned.

To add a runner by hand, add a row to Roster with the bib blank and run `assignBibs`.

### 3. The phones
Host the folder anywhere static (GitHub Pages is free; see below) and text each volunteer a link
with their job baked in:

```
https://<your-host>/index.html?mode=timer&race=Boys&device=Sam&endpoint=https://script.google.com/macros/s/.../exec
https://<your-host>/index.html?mode=finishers&race=Boys&device=Alex&endpoint=https://script.google.com/macros/s/.../exec
```

On the phone: open the link once **while online**, then **Share → Add to Home Screen** (iPhone) or
the browser's **Install app / Add to Home screen** (Android). From then on it opens without signal.
The ⚙ button changes race, name or endpoint at any time; each race's taps are kept separately.

## Race day
1. Both volunteers open the app on the first race, and the Finishers volunteer taps **Refresh bibs**
   while there is signal (bibs are cached after that).
2. Gun: Timer presses **START RACE**. From then on, only **LAP**, once per runner crossing the line.
3. In the chute, Finishers taps each bib as the runner passes. Runner with no bib → the orange
   button, and write down who it was. Misclick → **Undo** (it asks first).
4. After the last runner: both press **Send**. The message confirms the count and warns if the two
   lists differ in length. Then ⚙ → change the race name to the next race, and repeat.
5. Results: **Results** mode in the app, or the **Results** and **TeamScores** tabs in the sheet.

Scoring follows the standard rule: only teams with five or more finishers score, places are
renumbered among those runners only, the score is the sum of the first five, and a tie goes to the
better sixth runner.

### If the counts don't match
One list has a dropped or doubled entry and everything after it is shifted by one. Compare the two
lists against the chute order (keep a paper backup in the chute this first time); fix the row in the
**Times** or **Places** tab, then reload Results or press Send again from the phone.

## Hosting on GitHub Pages
```bash
gh repo create xc-race-tracker --public --source=. --push
gh api -X POST repos/{owner}/xc-race-tracker/pages -f 'source[branch]=main' -f 'source[path]=/'
```
The site is then at `https://<user>.github.io/xc-race-tracker/index.html`. Any push updates it.

## Development
```bash
python3 -m http.server 8765      # then open http://localhost:8765/index.html?race=Test&device=Me
node test/backend.test.js        # scoring, bib assignment and re-send behaviour, no Google needed
```
