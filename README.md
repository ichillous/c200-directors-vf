# C200 Viewfinder

A director's viewfinder for one camera and one lens: the Canon C200 with the Sigma 18-35mm f/1.8 Art. It runs in the phone's browser, installs to the home screen, and works offline once installed.

Point the phone at a scene, turn the focal ring, and the white rectangle shows what the C200 would record at that focal length. Capture the frame and it is saved with its focal length, tag and shoot.

## What it does

- **Viewfinder.** Live back camera with C200 frame lines for UHD 16:9 (SD card) and 4K DCI 17:9 (RAW). The ring is marked 18, 20, 24, 28, 35 like the lens. Readouts give the full-frame equivalent and the horizontal angle of view.
- **Shot Bank.** Every captured frame, filterable by tag and by shoot. Retag, refile, delete with undo, or send a frame back to the viewfinder to line it up again. Export packs all frames and their numbers into one zip.
- **Shoots.** Your shoot folders grouped FAMILY / FRIENDS / ME / PROJECTS. New shoots are named `YYYY-MM-DD_What`.
- **Shot board.** A shot list laid out by camera position. Pick a shot and the ring jumps to its planned focal length, with the planned range shaded.
- **Pre-roll check.** Camera, lens and both audio inputs.

## The maths

All of it is in [`src/optics.ts`](src/optics.ts) and tested in [`tests/optics.test.ts`](tests/optics.test.ts).

- C200 active sensor width: 24.6 mm in UHD, 26.2 mm in 4K DCI (6.4 µm pixel pitch).
- Phone camera: Google lists the Pixel 10 Pro main camera at 82° and the ultrawide at 123°, measured corner to corner on a 4:3 sensor, so the horizontal view is four fifths of that in tangent terms.
- Frame width on screen = `(sensor width / 2 / focal length) / tan(phone horizontal half-angle)`.

In UHD every focal length from 18 to 35 mm fits inside the main camera. In DCI, 18 mm is slightly wider than the main camera, and the app says so.

Phones crop a little for video, so if the lines look tighter or wider than the C200's picture, open **Phone camera** in the viewfinder and nudge the angle until they match.

## Your data stays on your phone

The app ships with no shoots and no shot lists. Frames are stored in the browser on the phone (IndexedDB) and are not uploaded anywhere.

Shoots and shot lists come in through **Shoots → Import shoots and shot lists**, from a JSON file like [`tests/fixtures/sample-data.json`](tests/fixtures/sample-data.json):

```json
{
  "version": 1,
  "shoots": [
    { "id": "a", "folder": "PROJECTS", "name": "2099-01-01_Example", "date": "2099-01-01", "place": "Somewhere" },
    { "id": "doc", "folder": "PROJECTS", "name": "A long project", "ongoing": true }
  ],
  "planned": [{ "id": "film", "name": "A short film", "shotListId": "film-list" }],
  "shotLists": [
    {
      "id": "film-list",
      "title": "A short film",
      "positions": { "1": "By the window" },
      "shots": [{ "no": "01", "name": "Opening", "pos": 1, "lo": 18, "hi": 24, "first": 20 }]
    }
  ]
}
```

A shoot with a full date today or later shows as upcoming. `pos: 0` marks a list entry that needs no camera. Focal lengths outside 18 to 35 are pulled into range. Files named `my-data*.json` are git-ignored so a personal file cannot be committed by accident.

## Install on the phone

Open the site in Chrome, allow the camera, then choose **Add to Home screen** from the browser menu. It opens full screen in landscape.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # lens maths and data-file tests
npm run build      # type-check and build to dist/
npm run preview    # serve the build on http://localhost:4173
npm run e2e        # browser test with a fake camera (needs Playwright with Chromium; run preview first)
```

Pushing to `main` runs the tests and deploys to GitHub Pages.
