# Question Bank

A static study site built from our course quizzes. It has two parts:

- **Study**: every question with its correct answer, grouped by topic or by quiz, with search.
- **Mock test**: pick topics or quizzes, choose a length, and answer one question at a time. You can
  see answers after each question or at the end, add an optional time limit, review your score by topic,
  and retry the ones you missed.

The site is plain HTML, CSS and JavaScript in `docs/`. There is no build step and nothing to install.

## Preview locally

```
python -m http.server 8000 -d docs
```

Then open http://localhost:8000. Opening `docs/index.html` directly from disk won't work, because
browsers block loading the data file that way.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository. `.gitignore` keeps out the request files (they hold a
   login token) and `output/` (raw reports with personal data).
2. In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick
   branch `main` and folder `/docs`.
3. The site appears at `https://<user>.github.io/<repo>/` after a minute or so.

GitHub Pages sites are public. Anyone with the link can open the site.

## Updating the questions

1. Copy fresh requests from the browser (DevTools → Network → right-click → Copy as cURL (cmd))
   into `quiz page request.txt`. The token expires after about an hour.
2. `python fetch_reports.py` downloads every quiz report into `output/`.
3. `python build_data.py` rebuilds `docs/data/questions.json`.

`build_data.py` assigns each question a topic using keyword rules. To fix a wrong topic, add the
question id to `topic_overrides.json`. Run `python build_data.py --review` to list every question by
topic. The same file can also hide an explanation that belongs to a different question
(`hide_explanation`). Some quizzes on the platform have their feedback attached to the wrong questions.
