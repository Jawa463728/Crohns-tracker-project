# My Health — Crohn's personal tracker

A mobile-first personal health PWA designed for GitHub Pages + Firebase.

## Included

- Secure Firebase email/password authentication
- Firestore persistence
- Daily medication logging with timestamps
- Rinvoq / Movicol stock countdown and reorder buffers
- Guided one-question-at-a-time daily check-in
- Wellbeing, stomach, fatigue, pain, bowel count, Bristol consistency
- Stress, activity, exercise, sleep duration/quality, food notes and food self-rating
- Quick bowel-movement logging
- Daily Balance score (personal tracking metric, not a medical score)
- 7/30/90-day charts
- History view
- JSON data export
- Crohn's headline ticker and News tab
- Free scheduled news refresh using GitHub Actions
- PWA/offline shell support

## 1. Create a Firebase project

1. Go to the Firebase console and create a project.
2. Add a **Web app**.
3. Copy the Firebase config object.
4. In this project, duplicate `firebase-config.example.js` and rename the copy to `firebase-config.js`.
5. Replace the placeholder values with your Firebase web config.

Firebase web config identifies the project; it is not your account password. Access to health records is controlled with Authentication and Firestore Security Rules.

## 2. Enable authentication

Firebase Console → Authentication → Sign-in method → enable **Email/Password**.

The UI asks for email + password because that gives you account recovery. Your display name acts as the human-readable username inside the app.

## 3. Create Firestore

Create a Cloud Firestore database.

Then publish the rules from `firestore.rules`:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

These rules are essential. Do not run the database in open/test mode permanently.

## 4. Test locally

Because the app uses JavaScript modules, serve the folder rather than double-clicking `index.html`.

If Python is installed:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## 5. Put it on GitHub Pages

1. Create a new public GitHub repository.
2. Upload every file in this folder, including `.github/workflows/update-news.yml`.
3. In GitHub → Settings → Pages, select **Deploy from a branch**.
4. Choose `main` and `/ (root)`.
5. Your site will appear at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## 6. Firebase authorised domain

In Firebase Authentication settings, add your GitHub Pages hostname:

`YOUR-USERNAME.github.io`

## 7. News updater

The included GitHub Action runs every 3 hours and refreshes `news.json`.

You can also run it manually:
Actions → Refresh Crohn's news → Run workflow.

No paid news API key is required.

## Medication stock behaviour

- Rinvoq defaults to a 14-day reorder buffer.
- Movicol defaults to a 7-day reorder buffer.
- When you mark a medication as taken, stock decreases by 1.
- If you undo that medication log, stock increases by 1.
- Change remaining stock at any time in **More → Prescription tracker**.

## Daily Balance score

This is intentionally **not** a Crohn's Disease Activity Index or clinical score.

It is a personal 0–100 summary based on logged wellbeing, stomach comfort, fatigue, pain, stress, activity, food self-rating, optional sleep quality and medication logging. Missing answers are ignored rather than treated as zero.

You can change the weighting in `healthScore()` inside `app.js`.

## Suggested next additions

- Optional richer sleep entry with exact bedtime and wake time
- Detailed food diary + favourites
- Blood/mucus trend charts
- Calendar editing of past days
- Prescription received button
- Notification support
- CSV/PDF report export
- Passkeys/biometric-friendly login
- More sophisticated correlation cards after enough data exists

## Important privacy notes

- Do **not** put your real health records directly in source files.
- Do **not** hard-code a password in JavaScript.
- Keep Firestore rules locked to `request.auth.uid`.
- Use a strong unique password.
- Health information is sensitive. This project is a personal tracker, not a medical device and not a substitute for clinical advice.
