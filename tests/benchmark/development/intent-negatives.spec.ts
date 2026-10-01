import { describe, expect, it } from 'vitest'
import { detectResumeIntent } from '../../../src/host/resume/index.js'

const negatives = [
  '帮我解释这段代码','今天天气怎么样','新建一个项目','总结一下今天的内容','alpha 是什么意思',
  'provider.ts 有几行','Chrome 打不开怎么办','Terminal 怎么改主题','帮我写个 README','谢谢，先这样',
  '这个报错什么意思','帮我看一下日志','把这段翻译成中文','优化一下这个函数','为什么编译失败',
  '打开 GitHub 看看 issue','查一下最新版本','写一个单元测试','帮我改变量名','这个 API 怎么用',
  '给我一个正则表达式','分析一下性能瓶颈','生成一个配置文件','比较这两个方案','解释一下 AXDocument',
  'OpenRhyme 是什么','My Day 怎么安装','DSH 插件怎么发布','SQLite 为什么是 0644','macOS AX 权限在哪开',
  'provider.ts 和 server.ts 有什么区别','alpha 和 beta 哪个目录大','Chrome 的 bundle id 是什么',
  'Terminal 当前版本是多少','Preview 支持什么格式','列出当前 workspace','查看最近的 git commit',
  '跑一下测试','构建这个项目','检查代码规范','这个 PDF 讲了什么','帮我找一个文件',
  '把窗口标题打印出来','统计今天用了哪些 app','做一个表格','给我写提交信息','检查依赖版本',
  '清理临时文件','关闭测试服务','完成后告诉我结果',
] as const

describe('resume intent negative development corpus', () => {
  it('does not trigger on ordinary non-resume requests', () => {
    const falseTriggers = negatives.filter(
      (query) => detectResumeIntent(query).isResume,
    )
    expect(falseTriggers).toEqual([])
  })
})
