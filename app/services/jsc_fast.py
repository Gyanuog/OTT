"""Fast YouTube JS-challenge solving for yt-dlp.

yt-dlp's node provider starts a fresh node process for every video and re-parses
the ~2.5MB YouTube player each time (~2s on a small VM). This module patches it
to use one long-lived node worker that loads the solver once and keeps the
preprocessed player in memory, so each later video only runs the tiny n/sig
functions. Falls back to yt-dlp's original behaviour if the worker fails.
"""
import itertools
import json
import subprocess
import threading

# Ensure vendor yt-dlp is in sys.path
from app.config import VENDOR_YTDLP  # noqa: F401
from yt_dlp.extractor.youtube.jsc._builtin import node as _node

WORKER_JS = r"""
const vm = require("vm"), readline = require("readline"), crypto = require("crypto");
const players = new Map();  // sha1(player source) -> preprocessed player
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = o => process.stdout.write(JSON.stringify(o) + "\n");
rl.on("line", line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  try {
    if (msg.init) {
      vm.runInThisContext(msg.lib); Object.assign(globalThis, lib); vm.runInThisContext(msg.core);
      return send({ id: msg.id, out: { type: "ready" } });
    }
    const d = msg.data;
    let out;
    if (d.type === "player") {
      const key = crypto.createHash("sha1").update(d.player).digest("hex");
      const pre = players.get(key);
      if (pre) out = jsc({ type: "preprocessed", preprocessed_player: pre, requests: d.requests });
      else {
        out = jsc({ ...d, output_preprocessed: true });
        if (out.preprocessed_player) {
          players.set(key, out.preprocessed_player);
          if (players.size > 3) players.delete(players.keys().next().value);
        }
      }
      delete out.preprocessed_player;
    } else out = jsc(d);
    send({ id: msg.id, out });
  } catch (e) {
    send({ id: msg.id, out: { type: "error", error: String((e && e.stack) || e) } });
  }
});
"""


class _Worker:
    def __init__(self):
        self.lock = threading.Lock()
        self.proc = None
        self.ids = itertools.count(1)
        self.waiting = {}

    def _start(self, node_path, lib, core):
        self.proc = subprocess.Popen(
            [node_path, "--experimental-permission", "--no-warnings=ExperimentalWarning", "-e", WORKER_JS],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()
        self._send({"init": True, "lib": lib, "core": core}, timeout=30)

    def _read(self, proc):
        for line in proc.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            slot = self.waiting.pop(msg.get("id"), None)
            if slot:
                slot[1] = msg.get("out")
                slot[0].set()
        for slot in list(self.waiting.values()):  # worker died: release everyone waiting
            slot[0].set()

    def _send(self, payload, timeout=20):
        mid = next(self.ids)
        slot = [threading.Event(), None]
        self.waiting[mid] = slot
        with self.lock:
            self.proc.stdin.write(json.dumps({"id": mid, **payload}) + "\n")
            self.proc.stdin.flush()
        if not slot[0].wait(timeout) or slot[1] is None:
            self.waiting.pop(mid, None)
            raise RuntimeError("jsc worker did not answer")
        return slot[1]

    def solve(self, node_path, lib, core, data):
        with self.lock:
            alive = self.proc is not None and self.proc.poll() is None
        if not alive:
            with self.lock:
                if self.proc is not None:
                    self.proc.kill()
                self.proc = None
            self._start(node_path, lib, core)
        return self._send({"data": data})


_worker = _Worker()
_pending = threading.local()
_orig_construct = _node.NodeJCP._construct_stdin
_orig_run = _node.NodeJCP._run_js_runtime


def _construct_stdin(self, player, preprocessed, requests):
    _pending.args = (player, preprocessed, requests)
    _pending.data = {
        "type": "preprocessed" if preprocessed else "player",
        ("preprocessed_player" if preprocessed else "player"): player,
        "requests": [{"type": r.type.value, "challenges": r.input.challenges} for r in requests],
    }
    return "\x00fast"


def _run_js_runtime(self, stdin):
    if stdin == "\x00fast":
        data = _pending.data
        try:
            out = _worker.solve(self.runtime_info.path, self._lib_script.code, self._core_script.code, data)
            return json.dumps(out)
        except Exception as e:  # anything odd: do exactly what yt-dlp would have done
            self.logger.debug(f"jsc worker failed ({e}); using one-shot node")
            stdin = _orig_construct(self, *_pending.args)
    return _orig_run(self, stdin)


def install():
    _node.NodeJCP._construct_stdin = _construct_stdin
    _node.NodeJCP._run_js_runtime = _run_js_runtime
