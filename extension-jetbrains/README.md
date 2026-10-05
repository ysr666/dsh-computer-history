# The JetBrains companion

Declares this IDE to the local Computer History Host, once per run, so the timeline can say which editor a
workspace was open in instead of guessing it from a window title. It is the client
`docs/plan-three-platforms.md` T7.1 asks for: the same documented protocol as the VS Code companion, no host
change.

The wire format is `docs/editor-companion.md`; this directory is only the JetBrains half of it.

## What it sends, and what it never sends

One `POST http://127.0.0.1:<port>/companion/observation` with `x-companion-token`, carrying the IDE's own name
and version as a **claim**:

```json
{
  "source": "editor",
  "app": { "bundleId": "com.jetbrains.intellij", "name": "IntelliJ IDEA 2025.2.5" },
  "workspaceRoot": "/absolute/path",
  "languageId": "java",
  "surfaceKind": "editor",
  "title": "the last path segment",
  "editorSession": "jetbrains-<pid>",
  "seq": 1,
  "observedAtMs": 1791167691094
}
```

`bundleId` is this plugin's declaration - the Host records it with `source.provider = "companion"`, so the audit
can always tell "an editor said it was this" from "the operating system saw this" - and `name` comes from the
IDE's own `ApplicationInfo`, which is what makes the declaration the client's rather than the collector's.

There is no field for document text, a selection, a diagnostic or a file's contents, and the Host refuses
unknown fields rather than ignoring them. Paths are metadata; contents are not.

## Building it

No Gradle, no Kotlin, no dependency download: the plugin is one Java class compiled against the platform jars the
IDE already ships, with the JDK the IDE already bundles.

```bash
IDE="/Applications/IntelliJ IDEA CE.app/Contents"
JBR="$IDE/jbr/Contents/Home/bin"

mkdir -p build/classes
"$JBR/javac" --release 21 -cp "$IDE/lib/*" -d build/classes $(find src/main/java -name '*.java')
cp -R src/main/resources/META-INF build/classes/
jar --create --file build/dsh-companion.jar -C build/classes .
```

## Installing it

The platform loads plugins from its own configuration directory, so the install is a file copy into the layout the
platform documents (`plugins/<name>/lib/<name>.jar`) - not a directory dropped somewhere the IDE never scans:

```bash
CONFIG="$HOME/Library/Application Support/JetBrains/IdeaIC2025.2"   # <product><version>, as the IDE names it
mkdir -p "$CONFIG/plugins/dsh-companion/lib"
cp build/dsh-companion.jar "$CONFIG/plugins/dsh-companion/lib/"
```

The directory name is derived from the product code and version: `IdeaIC2025.2` for a CE install of 2025.2,
`IntelliJIdea<version>` for an Ultimate one.

## Configuring it

The pairing token lives outside this repository, in the IDE's configuration directory:

```json
{ "port": 19488, "token": "<the token the panel shows>", "workspaceRoot": "/absolute/path/to/a/workspace" }
```

written to `$CONFIG/dsh-companion.json`. Without a readable token the plugin sends nothing at all, which is the
rule the protocol states. The token is issued by the Host's panel (`POST /api/computer-history/pairing/rotate`
returns it once, and it is stored only as a digest).

## Verifying it

The IDE writes the plugin's own lines to its log - `~/Library/Logs/JetBrains/<product><version>/idea.log` - and
the Host stores the row:

```bash
grep 'computer-history companion' ~/Library/Logs/JetBrains/IdeaIC2025.2/idea.log
curl -s -b <cookie> http://127.0.0.1:<host port>/api/computer-history/recent
```

**One trap worth knowing before you debug a silent companion:** the Host refuses every companion payload while
its collector is not `running` - a Host whose collector is degraded (an Accessibility grant missing on macOS, for
instance) answers `202 {"stored":false}` and records nothing, whatever the IDE sends.
