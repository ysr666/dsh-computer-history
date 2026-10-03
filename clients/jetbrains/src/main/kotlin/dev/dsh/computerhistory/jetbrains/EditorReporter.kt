package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.vfs.VirtualFile

/**
 * Reports the file the editor is showing.
 *
 * What leaves this class is a path, a language id and a file name - the editor companion payload has no field
 * for contents, selections or keystrokes, so there is nothing to redact and nothing to forget to redact.
 */
class EditorReporter : FileEditorManagerListener {
    override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
        // Logged unconditionally for the same reason as the application-scoped class: which hook actually
        // fires in LightEdit is the question, and an absence of evidence is not an answer to it.
        java.util.logging.Logger.getLogger("computer-history.jetbrains")
            .info("computer-history: fileOpened for ${file.path}")
        val root = workspaceRootFor(source.project, file)
        CompanionClient.report(
            workspaceRoot = root,
            filePath = file.path,
            languageId = file.fileType.name.lowercase(),
            surfaceKind = "editor",
            title = file.name,
        )
    }
}
