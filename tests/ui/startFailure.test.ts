import { describe, it, expect } from 'vitest'
import { showStartFailure } from '../../src/ui/startFailure'
import { t } from '../../src/ui/i18n'

/** Just enough of the DOM for the start-failure screen, in memory (no jsdom here). */
class FakeElement {
  className = ''
  textContent = ''
  type = ''
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  private readonly clickListeners: (() => void)[] = []

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child)
    return child
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(event: string, listener: () => void): void {
    if (event === 'click') this.clickListeners.push(listener)
  }

  click(): void {
    for (const listener of this.clickListeners) listener()
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase(), this)
  }
}

function mount(onReload: () => void): FakeElement {
  const root = new FakeDocument().createElement('body')
  showStartFailure(root as unknown as HTMLElement, onReload)
  return root
}

describe('showStartFailure', () => {
  it('puts a visible alert with the translated message on an otherwise blank root', () => {
    const root = mount(() => {})
    const overlay = root.children[0]
    expect(overlay?.attributes.get('role')).toBe('alert')
    expect(root.descendants().map((el) => el.textContent)).toContain(t('error.startFailed'))
  })

  it('offers a reload button that runs the reload action', () => {
    let reloaded = false
    const root = mount(() => {
      reloaded = true
    })
    const button = root.descendants().find((el) => el.tagName === 'BUTTON')
    expect(button?.textContent).toBe(t('error.reload'))

    button?.click()

    expect(reloaded).toBe(true)
  })
})
