# Computer History companion for JetBrains IDEs

An IntelliJ Platform plugin that reports **which file the editor is showing** to a local Computer History
intake, using the editor companion contract the Host already defines (`EditorCompanionPayload`):
`POST /companion/observation` with an `x-companion-token` header.

It is not a collector. It observes nothing outside its own process, and the payload type has no field that
could carry file contents, selections or keystrokes - the intake refuses unknown fields rather than ignoring
them, so there is nothing to redact and nothing to forget to redact.

## Build

```console
$ gradle build          # uses the IDE installed at /Applications/IntelliJ IDEA CE.app
```

`build.gradle.kts` points at the installed IDE (`intellijPlatform { local(...) }`) instead of downloading one:
the plugin is built against the same build the machine runs, and the download is a gigabyte nobody needs.

## Run against an intake

The pairing token is per-installation and is **not** compiled into the plugin. Pass it, and the intake port, as
system properties to the IDE:

```console
$ cat /tmp/idea.vmoptions
-Dcomputer-history.port=19388
-Dcomputer-history.token=<the token the panel showed once>
-Didea.plugins.path=/tmp/plugins          # the built jar, if not installing it normally
$ IDEA_VM_OPTIONS=/tmp/idea.vmoptions "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea" /path/to/file.kt
```

With no token the plugin reports nothing and says so once in the IDE log (`Help > Show Log in Finder`), because
posting something the Host will refuse is worse than staying quiet.

## Two things the contract decided for this client

- **A file outside the project is still a workspace.** Opening a single file puts the IDE in LightEdit, where
  `project.basePath` is the IDE's own configuration directory. The Host enforces
  `filePath must live under workspaceRoot` and refused the first version with exactly that message; the client
  now declares the file's own directory in that case, which is what the workspace actually is.
- **The default project is not a workspace.** Its base path is the configuration directory too, so it is not
  reported at all.
