import { describe, expect, it } from 'vitest'
import { mergeIntoPrevious, parseFdx, parseFountainScript, parseScriptFile, sceneFlags, splitAt, splitNumber, toPayload } from './importScript'

const FOUNTAIN = `Title: The Last Ferry
Author: A. Writer

FADE IN:

INT. SMALL APARTMENT KITCHEN - NIGHT

Rain on the window. [[note to self]] Anna waits.

ANNA
(quietly)
Not yet.

CUT TO:

EXT. STREET - CONTINUOUS #2A#

Daniel waits.

/* cut for time */

= a synopsis line
# Act two

INT. HALLWAY - LATER

The door opens.
`

describe('parseFountainScript', () => {
  const r = parseFountainScript(FOUNTAIN)
  it('finds the scenes and leaves out the title page', () => {
    expect(r.scenes.map((s) => s.heading)).toEqual(['INT. SMALL APARTMENT KITCHEN - NIGHT', 'EXT. STREET - CONTINUOUS', 'INT. HALLWAY - LATER'])
    expect(r.notes.join(' ')).toMatch(/title page/i)
  })
  it('keeps text before the first heading at the start of scene 1', () => {
    expect(r.scenes[0].elements[0]).toEqual({ kind: 'action', text: 'FADE IN:' })
    expect(r.notes.join(' ')).toMatch(/before the first scene heading/)
  })
  it('reads elements and drops notes, boneyard, sections and synopses', () => {
    const k = r.scenes[0].elements.map((e) => e.kind)
    expect(k).toEqual(expect.arrayContaining(['action', 'character', 'parenthetical', 'dialogue', 'transition']))
    expect(r.scenes[0].elements.find((e) => e.kind === 'action')!.text).not.toMatch(/note to self/)
    expect(JSON.stringify(r.scenes)).not.toMatch(/synopsis|Act two|cut for time/)
  })
  it('takes scene numbers written as #2A#', () => {
    expect(r.scenes[1].number).toBe('2A')
    expect(r.scenes[0].number).toBeNull()
  })
  it('does not mistake words like Interior for a heading', () => {
    const t = parseFountainScript('INT. A - DAY\n\nInterior designers argue.\n').scenes
    expect(t).toHaveLength(1)
  })
  it('reads omitted scenes with their number', () => {
    const t = parseFountainScript('INT. A - DAY\n\nHello.\n\n42 OMITTED\n\nINT. B - DAY\n\nBye.\n').scenes
    expect(t[1]).toMatchObject({ omitted: true, number: '42' })
  })
  it('reports a file with no scene headings', () => {
    const t = parseFountainScript('Just some words.\n\nMore words.')
    expect(t.scenes).toHaveLength(1)
    expect(t.notes.join(' ')).toMatch(/No scene headings/)
  })
  it('handles empty input', () => {
    expect(parseFountainScript('  \n').scenes).toHaveLength(0)
  })
})

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
<Content>
<Paragraph Type="Action"><Text>FADE IN:</Text></Paragraph>
<Paragraph Number="1" Type="Scene Heading"><Text>INT. KITCHEN - NIGHT</Text></Paragraph>
<Paragraph Type="Action"><Text>Tom &amp; Anna argue.</Text></Paragraph>
<Paragraph Type="Character"><Text>ANNA</Text></Paragraph>
<Paragraph Type="Parenthetical"><Text>(low)</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>It&apos;s </Text><Text AdornmentStyle="1">over.</Text></Paragraph>
<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
<Paragraph Number="1A" Type="Scene Heading"><Text>EXT. STREET - DAY</Text></Paragraph>
<Paragraph Type="General"><Text>A car passes.</Text></Paragraph>
<Paragraph Number="2" Type="Scene Heading"><Text>OMITTED</Text></Paragraph>
</Content>
<TitlePage><Content><Paragraph Type="Action"><Text>THE LAST FERRY</Text></Paragraph></Content></TitlePage>
</FinalDraft>`

describe('parseFdx', () => {
  const r = parseFdx(FDX)
  it('reads scenes with their numbers and omitted markers', () => {
    expect(r.scenes.map((s) => [s.number, s.heading, s.omitted])).toEqual([
      ['1', 'INT. KITCHEN - NIGHT', false], ['1A', 'EXT. STREET - DAY', false], ['2', 'OMITTED', true],
    ])
  })
  it('reads elements, joins text runs and decodes entities', () => {
    expect(r.scenes[0].elements).toEqual([
      { kind: 'action', text: 'FADE IN:' }, { kind: 'action', text: 'Tom & Anna argue.' },
      { kind: 'character', text: 'ANNA' }, { kind: 'parenthetical', text: '(low)' },
      { kind: 'dialogue', text: "It's over." }, { kind: 'transition', text: 'CUT TO:' },
    ])
    expect(r.scenes[1].elements).toEqual([{ kind: 'action', text: 'A car passes.' }])
  })
  it('ignores the title page', () => {
    expect(JSON.stringify(r)).not.toMatch(/THE LAST FERRY/)
  })
  it('is chosen by file name or content', () => {
    expect(parseScriptFile('x.fdx', FDX).format).toBe('fdx')
    expect(parseScriptFile('x.txt', FDX).format).toBe('fdx')
    expect(parseScriptFile('x.fountain', 'INT. A - DAY\n\nHi.').format).toBe('fountain')
    expect(parseScriptFile('x.txt', 'INT. A - DAY\n\nHi.').format).toBe('text')
  })
})

describe('review helpers', () => {
  it('splits a number off a heading', () => {
    expect(splitNumber('INT. A - DAY #12B#')).toEqual({ text: 'INT. A - DAY', number: '12B' })
    expect(splitNumber('INT. A - DAY').number).toBeNull()
  })
  it('flags empty scenes, odd headings and repeated numbers', () => {
    const { scenes } = parseFdx(FDX)
    scenes[1].number = '1'
    scenes[1].heading = 'THE ROOF'
    scenes[1].elements = []
    const f = sceneFlags(scenes)
    expect(f.get(scenes[0].key)).toContain('dupnumber')
    expect(f.get(scenes[1].key)).toEqual(expect.arrayContaining(['oddheading', 'empty', 'dupnumber']))
    expect(f.get(scenes[2].key)).toEqual([])
  })
  it('merges a scene into the one before and keeps its heading as action', () => {
    const { scenes } = parseFdx(FDX)
    const m = mergeIntoPrevious(scenes, 1)
    expect(m).toHaveLength(2)
    expect(m[0].elements.map((e) => e.text)).toContain('EXT. STREET - DAY')
    expect(m[0].elements.map((e) => e.text)).toContain('A car passes.')
  })
  it('splits a scene at an element', () => {
    const { scenes } = parseFdx(FDX)
    const s = splitAt(scenes, 0, 2)
    expect(s).toHaveLength(4)
    expect(s[0].elements).toHaveLength(2)
    expect(s[1].heading).toBe('')
    expect(s[1].elements).toHaveLength(4)
  })
  it('builds the payload: numbers kept, or a plain draft without omitted scenes', () => {
    const { scenes } = parseFdx(FDX)
    expect(toPayload(scenes, true).map((p) => [p.number, p.omitted])).toEqual([['1', false], ['1A', false], ['2', true]])
    expect(toPayload(scenes, false)).toHaveLength(2)
    expect(toPayload(scenes, false)[0].number).toBeNull()
  })
})
