import { useInstallHint } from '../lib/install'
import { Banner } from './ui'

/** Offers to install LineBoard on the home screen. Shows nothing when already installed or when the browser cannot install. */
export function InstallHint() {
  const { kind, install, dismiss } = useInstallHint()
  if (!kind) return null
  return kind === 'prompt' ? (
    <Banner lead="Install" action={
      <span className="lb-row">
        <button type="button" className="lb-btn lb-btn--primary lb-btn--sm" onClick={() => void install()}>Install LineBoard</button>
        <button type="button" className="lb-btn lb-btn--sm" onClick={dismiss}>Not now</button>
      </span>}>
      Put LineBoard on your home screen to open it like an app.
    </Banner>
  ) : (
    <Banner lead="Install" action={<button type="button" className="lb-btn lb-btn--sm" onClick={dismiss}>Not now</button>}>
      To put LineBoard on your home screen, tap Share, then Add to Home Screen.
    </Banner>
  )
}
