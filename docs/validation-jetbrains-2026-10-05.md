# The JetBrains client, live (T7.1) — 2026-10-05

`docs/plan-three-platforms.md` T7.1 asks for "a new client implementing the documented protocol. No host
change.", accepted by "a live JetBrains run stores a row whose identity came from the client's own declaration",
verified by "the live row plus the client's own log". All three are below, from a run of **IntelliJ IDEA CE
2025.2.5 (IC-252.28238.7)** on this machine.

The client is `extension-jetbrains/` - one Java class, no Gradle, no Kotlin, no dependency download: it compiles
against the platform jars the IDE ships and runs on the JDK it bundles.

## The client's own log

```text
2026-10-05 10:38:22,903 [   1117]   INFO - #dev.dsh.history.companion.CompanionStartup - computer-history companion: started, declaring com.jetbrains.intellij (IntelliJ IDEA 2025.2.5, IC IC-252.28238.7)
2026-10-05 10:38:23,018 [   1232]   INFO - #dev.dsh.history.companion.CompanionStartup - computer-history companion: declared com.jetbrains.intellij to port 19488, answer 201 {"stored":true}
```

`~/Library/Logs/JetBrains/IdeaIC2025.2/idea.log`. The name and version in the first line come from the IDE's own
`ApplicationInfo`, which is what makes the declaration the client's rather than the collector's.

## The stored row

```json
{"id":"episode:companion-…",
 "surfaces":[{"bundleId":"com.jetbrains.intellij","surfaceKind":"editor","title":"jb-workspace",…}],
 "resources":[{"displayLabel":"jb-workspace",…}]}
```

`bundleId` is the claim the plugin declared, recorded with `source.provider = "companion"` - the audit can tell
it apart from anything the operating system observed.

## Reproducing it

```bash
# build (the IDE's own JDK and platform jars)
IDE="/Applications/IntelliJ IDEA CE.app/Contents"; JBR="$IDE/jbr/Contents/Home/bin"
mkdir -p build/classes
"$JBR/javac" --release 21 -cp "$IDE/lib/*" -d build/classes $(find src/main/java -name '*.java')
cp -R src/main/resources/META-INF build/classes/
jar --create --file build/dsh-companion.jar -C build/classes .

# install into the platform's own plugin layout, and point it at a token
CFG="$HOME/Library/Application Support/JetBrains/IdeaIC2025.2"
mkdir -p "$CFG/plugins/dsh-companion/lib"
cp build/dsh-companion.jar "$CFG/plugins/dsh-companion/lib/"
# $CFG/dsh-companion.json: {"port":19488,"token":"<from the panel>","workspaceRoot":"/abs/path"}

# the token comes from a running Host
curl -s -b "$JAR" -X POST http://127.0.0.1:19500/api/computer-history/pairing/rotate

open -a "IntelliJ IDEA CE"          # one observation per run, on appStarted
grep 'computer-history companion' ~/Library/Logs/JetBrains/IdeaIC2025.2/idea.log
```

## Three things worth keeping

* **The Host refuses every companion payload while its collector is not `running`.** `deliver` in
  `src/host/plugin.ts` checks `snapshot?.state !== 'running'` and answers `202 {"stored":false}` with no reason.
  A user whose collector is degraded - an Accessibility grant missing on macOS, say - gets an editor companion
  that silently stores nothing. The first draft of this run hit exactly that: every payload answered 202 until
  the VM collector was up.
* **An editor payload is recorded with `adapter: 'vscode'`**, hardcoded in `companionObservation`, while
  `docs/editor-companion.md` invites any editor. Harmless for an editor surface today, and worth naming before a
  second editor arrives.
* **The platform tells you where its config lives; deriving it is how you get it wrong.** The first build built
  the path as `IdeaIC` + the full version (`IdeaIC2025.2.5`) while the platform uses `IdeaIC2025.2`, and the
  plugin logged "no …/dsh-companion.json, sending nothing" - a silent client, four minutes after a silent
  collector had been debugged. `PathManager.getConfigPath()` is the answer, and the class it lives in was found
  by listing the platform's own jars rather than guessing the package.

> **2026-10-05 之后的说明**：本次记录里的客户端 `extension-jetbrains/` 已按所有者决定删除；
> 仓库现在只保留一份 JetBrains 客户端 `clients/jetbrains/`（Kotlin + Gradle，支持 2024.2 起、
> 跟随 `FileEditorManagerListener` 报当前文件、字段更全）。这份记录按其日期保留，作为当时那次 live run 的证据。
