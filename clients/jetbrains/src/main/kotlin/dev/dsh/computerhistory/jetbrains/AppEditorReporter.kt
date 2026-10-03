package dev.dsh.computerhistory.jetbrains

import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import java.io.File

/**
 * Application-scoped reporting for every editor the IDE creates.
 *
 * The first version reported from a project activity and a project-scoped file listener, and reported nothing
 * in a live run. The reason is a platform fact rather than a payload bug: **project-level listeners are not
 * registered for the default project**, and opening a single file puts the IDE in LightEdit, where the file
 * lives in exactly that project. Both hooks were correct and unreachable.
 *
 * This platform build exposes no application-initialized hook (`com.intellij.openapi.startup` contains only
 * project-scoped activities, and `ApplicationInitializedListener` is not in the distribution), so the
 * application-scoped listener declaration in plugin.xml is the hook that exists here. It is marked deprecated
 * upstream; the comment in plugin.xml records why it is used anyway.
 */
class AppEditorReporter : EditorFactoryListener {
    override fun editorCreated(event: EditorFactoryEvent) {
        val file = event.editor.virtualFile ?: return
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
