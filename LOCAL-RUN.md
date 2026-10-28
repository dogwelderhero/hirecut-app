# Run hirecute on your computer

You need **Docker Desktop**, installed and running: the whale icon in the menu
bar should say "Docker Desktop is running".

## Start

**Mac:**
- Double-click `up.command` in this folder.
- Or, in Terminal, from this folder:
  ```
  ./up.sh               # the normal split between journeys, as a new visitor gets it
  ./up.sh recruiter     # open one journey directly
  ./up.sh vacancy
  ```

**Windows:** double-click `up.cmd`, or run `up.cmd recruiter` in a terminal.

The first start asks for the model key:

1. `up` creates the file `.env.hirecute.local` and stops. On Windows it also
   opens the file in Notepad.
2. Open the file and paste the key after `HIRECUTE_MODEL_API_KEY=`, on the
   same line, with no spaces.
3. Save it and start again.

The file stays on your computer and is never committed.

The first build takes a few minutes. After that, `up` rebuilds only what
changed. When the app is ready, `up` opens the browser at the right address.

## Stop

- **Mac:** double-click `down.command`, or run `./down.sh`.
- **Windows:** double-click `down.cmd`.

## Good to know

- **Use the address `up` opens, `http://127.0.0.1:8080`.** If you open
  `localhost:8080` instead, uploads fail with "Request blocked". The app
  checks the address.
- **One browser remembers its journey.** To try the other journey after a run
  has started, press "Start over", run `./up.sh <journey>` again, or use a
  private window.
- **Settings live in `.env.hirecute.local`:** the models, the resume-parse
  mode and the journey split. Each setting is explained in
  `.env.hirecute.example`. Run `up` again after you change one.
- **Runs are not kept after `down`.** Start again from the upload.
- **If something goes wrong**, `up` prints the reason and the last lines of
  the app's log. To see the full log: `docker logs -f hirecute-local`.
