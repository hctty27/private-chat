import { afterEach } from 'vitest'

if (typeof globalThis.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {}
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: TestPointerEvent,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})
