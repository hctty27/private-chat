from pathlib import Path

path = Path('frontend/src/views/MobileChat.vue')
source = path.read_text()
replacements = [
    ("const doubleTap = useDoubleTap<Message>((message) => {\n  startReply(message)\n})", "const doubleTap = useDoubleTap<Message>((message, point) => {\n  suppressNativeClickUntil = Date.now() + 600\n  openMessageMenuAt(point.x, point.y, message)\n})"),
    ('''function onMessagePointerDown(event: PointerEvent, message: Message) {\n  if (message.msgType !== 1 && message.msgType !== 4) {\n    doubleTap.cancel()\n    return\n  }\n  const target = event.target instanceof Element ? event.target : null\n  if (target?.closest('button, a, img, video, [role="button"]')) {\n    doubleTap.cancel()\n    return\n  }\n  doubleTap.start(event, message)\n}''', '''function onMessagePointerDown(event: PointerEvent, message: Message) {\n  doubleTap.start(event, message)\n}'''),
    ('''function guardNativeMessageClick(event: MouseEvent) {\n  if (Date.now() >= suppressNativeClickUntil) return\n  suppressNativeClickUntil = 0\n  event.preventDefault()\n  event.stopPropagation()\n}''', '''function guardNativeMessageClick(event: MouseEvent) {\n  const anchor = event.currentTarget instanceof HTMLAnchorElement ? event.currentTarget : null\n  if (!anchor) return\n  event.preventDefault()\n  event.stopPropagation()\n  const href = anchor.href\n  const fileName = anchor.getAttribute('download') || ''\n  const clickAt = Date.now()\n  window.setTimeout(() => {\n    if (suppressNativeClickUntil > clickAt) return\n    if (isIOS) {\n      window.location.assign(href)\n      return\n    }\n    const delayedAnchor = document.createElement('a')\n    delayedAnchor.href = href\n    delayedAnchor.target = '_blank'\n    delayedAnchor.rel = 'noopener noreferrer'\n    if (fileName) delayedAnchor.download = fileName\n    document.body.appendChild(delayedAnchor)\n    delayedAnchor.click()\n    delayedAnchor.remove()\n  }, 340)\n}'''),
    ('''  if (Date.now() < suppressNativeClickUntil) {\n    suppressNativeClickUntil = 0\n    event.preventDefault()\n    event.stopPropagation()\n    return\n  }\n  void openPreview(url, type, posterUrl)''', '''  event.preventDefault()\n  event.stopPropagation()\n  const clickAt = Date.now()\n  window.setTimeout(() => {\n    if (suppressNativeClickUntil > clickAt) return\n    void openPreview(url, type, posterUrl)\n  }, 340)'''),
]
for old, new in replacements:
    if old in source:
        source = source.replace(old, new, 1)
    elif new not in source:
        raise SystemExit(f'expected source block not found: {old[:80]}')
path.write_text(source)

test_path = Path('frontend/src/views/MobileChat.ios.test.ts')
test_source = test_path.read_text()
marker = "describe('MobileChat iOS visual polish', () => {"
addition = '''describe('MobileChat message actions', () => {\n  it('opens the existing action menu from a touch double tap for every message type', () => {\n    expect(mobileChatSource).toContain('const doubleTap = useDoubleTap<Message>((message, point) => {')\n    expect(mobileChatSource).toContain('openMessageMenuAt(point.x, point.y, message)')\n    expect(mobileChatSource).toContain('function onMessagePointerDown(event: PointerEvent, message: Message) {\\n  doubleTap.start(event, message)')\n    expect(mobileChatSource).not.toContain('message.msgType !== 1 && message.msgType !== 4')\n  })\n\n  it('defers media and file single-tap actions so a double tap can win', () => {\n    expect(mobileChatSource).toContain('const clickAt = Date.now()')\n    expect(mobileChatSource).toContain('if (suppressNativeClickUntil > clickAt) return')\n    expect(mobileChatSource).toContain('}, 340)')\n  })\n})\n\n'''
if addition not in test_source:
    if marker not in test_source:
        raise SystemExit('test insertion marker not found')
    test_path.write_text(test_source.replace(marker, addition + marker, 1))
