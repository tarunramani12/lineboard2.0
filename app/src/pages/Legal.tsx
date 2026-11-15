import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../components/ui'

// Public pages: no sign-in needed. Only what is needed and legal; a lawyer should review them before LineBoard is sold.
// The contact address comes from the build (VITE_CONTACT_EMAIL), so it is not written into the code.
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim()
const UPDATED = '15 November 2026'

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="lb-account lb-legal">
      <div className="lb-stack" style={{ alignItems: 'flex-start' }}>
        <Link to="/signin" aria-label="LineBoard home"><Wordmark large /></Link>
      </div>
      <div className="lb-card lb-stack" style={{ padding: 24 }}>
        <h1 className="lb-title">{title}</h1>
        <p className="lb-caption">Last updated {UPDATED}</p>
        {children}
      </div>
      <p className="lb-caption"><Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/signin">Back to sign in</Link></p>
    </main>
  )
}
const H = ({ children }: { children: ReactNode }) => <h2 className="lb-heading" style={{ fontSize: 17 }}>{children}</h2>
const Contact = () => CONTACT ? <>write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a></> : <>ask the admin of the project you belong to</>

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <H>What we keep</H>
      <p>Your email address and name, and what you and your project team enter into a project, including names, roles, phone numbers and emails of cast and crew. If you sign in with Google, we receive your name and email address from Google, and nothing else.</p>
      <H>Why</H>
      <p>To run LineBoard for you and your project. We do not sell data and we do not use it for advertising.</p>
      <H>Who sees it</H>
      <p>Only the people on your project, and only what the project admin allows them to see. Nothing is public.</p>
      <H>Where it is kept</H>
      <p>With service providers that host the data, deliver the website and send emails, in the European Union. Providers outside the European Union may handle the delivery of the website, under the safeguards the law requires. Map and weather services receive the location or map area you look at.</p>
      <H>How long</H>
      <p>As long as your account or project exists. Deleting a project deletes its data. Deleting your account removes your sign-in and your name.</p>
      <H>Your rights</H>
      <p>You can ask to see, correct, export or delete your data, and you can complain to your data protection authority. You can delete your account in Account settings. For anything else, <Contact />.</p>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="Terms of use">
      <H>Using LineBoard</H>
      <p>Give true details when you sign up, keep your sign-in private, and do not use LineBoard to break the law, to share what you have no right to share, or to reach what you were not given access to. Creating a project is by invitation for now.</p>
      <H>Your content</H>
      <p>What you put into LineBoard stays yours. You allow us to store it and show it to the people on your project. The project admin decides who joins and is responsible for having the right to enter other people's details.</p>
      <H>The service</H>
      <p>LineBoard is provided as it is, without promise that it will never be interrupted. Keep your own copy of anything important. We may change features and limits, and will not charge for a project without your agreement.</p>
      <H>Ending</H>
      <p>You can delete your account or project at any time. We may suspend an account that breaks these terms.</p>
      <H>Liability</H>
      <p>As far as the law allows, we are not responsible for indirect losses. Nothing here limits rights you have by law. Questions: <Contact />.</p>
    </Page>
  )
}
