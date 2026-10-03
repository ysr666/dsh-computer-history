package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import java.io.File
import java.util.logging.Logger

/**
 * Application-scoped reporting, registered through plugin.xml's `applicationListeners`.
 *
 * This class exists to answer one question with evidence instead of theory: in LightEdit - opening a single
 * file - is an application-scoped listener attached at all? Project-scoped hooks demonstrably do not always
 * run there, and the round before this one concluded from a single silent run that the deprecated registration
 * was being ignored. That conclusion was not supported: the same run's log was never checked for whether the
 * file had opened, so "not registered" and "no event" were indistinguishable.
 *
 * The first line of `editorCreated` therefore logs unconditionally. A run that shows the plugin loaded, the
 * file opened, and this line absent proves the registration is dead; a run that shows the line proves the
 * earlier silence was an event that never happened.
 */
class AppEditorReporter : EditorFactoryListener {
    private val log: Logger = Logger.getLogger("computer-history.jetbrains")

    override fun editorCreated(event: EditorFactoryEvent) {
        val file = event.editor.virtualFile
        log.info("computer-history: editorCreated for ${file?.path ?: "(no file)"}")
        if (file == null) return
        val project = event.editor.project
        val root = if (project == null || project.isDefault) {
            file.parent?.path ?: File(file.path).parent ?: return
        } else {
            workspaceRootFor(project, file)
        }
        CompanionClient.report(
            workspaceRoot = root,
            filePath = file.path,
            languageId = file.fileType.name.lowercase(),
            surfaceKind = "editor",
            title = file.name,
        )
    }
}
