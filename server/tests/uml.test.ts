/** UML Studio: model, validation, editing, layout, rendering, exports, generation (text / source / repository / AI) and API. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { clearStatusCache } from '../src/providers/index.js';
import { generateWithRules } from '../src/uml/rules.js';
import { classDiagramFromSource, sequenceFromSource, activityFromSource, typeHeads } from '../src/uml/from-source.js';
import { parseComposeServices } from '../src/uml/from-repo.js';
import { convertAi } from '../src/uml/ai.js';
import { findBrowser } from '../src/repo/report.js';
import { writeSampleRepo } from './helpers/sampleRepo.js';
import {
  DIAGRAM_TYPES, ELEMENT_KINDS, RELATIONSHIP_KINDS, template, parseDiagram, safeParseDiagram, validateDiagram, pruneInvalid, emptyDiagram, addElement, updateElement, deleteElement,
  addRelationship, updateRelationship, deleteRelationship, moveElement, moveMessage, History, autoLayout, geometry, render, toSvg, serialize, toPlantUml, toMermaid, textWidth, type Diagram,
} from '../../shared/uml/index.js';

openDatabase(':memory:');
const app = createApp();

const overlaps = (d: Diagram) => {
  const g = geometry(d);
  const ids = Object.keys(g.boxes).filter((k) => !g.containers.has(k));
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = g.boxes[ids[i]];
    const b = g.boxes[ids[j]];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
  }
  return n;
};

// =================================================================== model + validation
describe('UML model and validation', () => {
  it('every starter template is a valid, overlap-free diagram inside the canvas', () => {
    for (const t of DIAGRAM_TYPES) {
      const d = template(t);
      const v = validateDiagram(d);
      expect(v.errors, `${t}: ${v.errors.map((e) => e.message).join('; ')}`).toEqual([]);
      expect(overlaps(d), t).toBe(0);
      const g = geometry(d);
      for (const b of Object.values(g.boxes)) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(g.width);
        expect(b.y + b.h).toBeLessThanOrEqual(g.height);
      }
    }
  });
  it('serialises and deserialises without loss', () => {
    for (const t of DIAGRAM_TYPES) {
      const d = template(t);
      expect(parseDiagram(JSON.parse(JSON.stringify(d)))).toEqual(d);
    }
  });
  it('rejects structurally invalid models with clear messages', () => {
    expect(safeParseDiagram({ type: 'flowchart', elements: [] }).ok).toBe(false);
    const bad = safeParseDiagram({ type: 'class', elements: [{ id: 'has space', kind: 'class', name: 'A' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join()).toMatch(/ids may contain/);
    expect(safeParseDiagram({ type: 'class', elements: [{ id: 'a', kind: 'spaceship', name: 'A' }] }).ok).toBe(false);
  });
  it('catches duplicate ids, missing endpoints, wrong kinds, invalid endpoints and cycles', () => {
    const d = template('class');
    const codes = (x: unknown) => validateDiagram(x).errors.map((e) => e.code);
    expect(codes({ ...d, elements: [...d.elements, { ...d.elements[0] }] })).toContain('duplicate-id');
    expect(codes({ ...d, relationships: [...d.relationships, { id: 'x1', kind: 'association', source: 'Student', target: 'Ghost', label: '' }] })).toContain('missing-endpoint');
    expect(codes({ ...d, relationships: [...d.relationships, { id: 'x2', kind: 'transition', source: 'Student', target: 'Course', label: '' }] })).toContain('relationship-kind');
    expect(codes({ ...d, elements: [...d.elements, { id: 'a1', kind: 'actor', name: 'Bob' }] })).toContain('element-kind');
    expect(codes({ ...d, relationships: [...d.relationships, { id: 'x3', kind: 'inheritance', source: 'Person', target: 'Student', label: '' }] })).toContain('inheritance-cycle');
    const uc = template('usecase');
    expect(codes({ ...uc, relationships: [...uc.relationships, { id: 'x4', kind: 'include', source: 'customer', target: 'login', label: '' }] })).toContain('invalid-endpoint');
    const act = template('activity');
    expect(codes({ ...act, relationships: [...act.relationships, { id: 'x5', kind: 'flow', source: 'end', target: 'start', label: '' }] })).toEqual(expect.arrayContaining(['invalid-endpoint']));
    const dep = template('deployment');
    expect(codes({ ...dep, elements: dep.elements.map((e) => (e.id === 'client' ? { ...e, parent: 'spa' } : e)) })).toEqual(expect.arrayContaining(['invalid-parent']));
  });
  it('reports notation warnings (decision guards, isolated use cases, missing initial node)', () => {
    const act = template('activity');
    const w = validateDiagram({ ...act, relationships: act.relationships.map((r) => (r.kind === 'flow' ? { ...r, guard: '' } : r)) }).warnings.map((x) => x.code);
    expect(w).toContain('decision-guard');
    const st = template('state');
    expect(validateDiagram({ ...st, elements: st.elements.filter((e) => e.kind !== 'initial'), relationships: st.relationships.filter((r) => r.source !== 'i') }).warnings.map((x) => x.code)).toContain('no-initial');
  });
  it('pruneInvalid removes dangling relationships and reports each one', () => {
    const d = template('object');
    const r = pruneInvalid({ ...d, relationships: [...d.relationships, { id: 'z', kind: 'link', source: 'asha', target: 'nobody', label: '', sourceRole: '', targetRole: '', sourceMultiplicity: '', targetMultiplicity: '' }] });
    expect(r.removed).toEqual(['Link asha → nobody']);
    expect(validateDiagram(r.diagram).valid).toBe(true);
  });
});

// =================================================================== editing operations
describe('UML editing operations', () => {
  it('adds, updates and deletes elements; deleting cascades relationships and children', () => {
    let d = emptyDiagram('class', 'Edit test');
    const a = addElement(d, 'class', { name: 'Order' });
    d = a.diagram;
    const b2 = addElement(d, 'class', { name: 'Item' });
    d = b2.diagram;
    d = addRelationship(d, 'composition', a.id, b2.id, { targetMultiplicity: '1..*' } as never).diagram;
    d = updateElement(d, a.id, { name: 'PurchaseOrder', attributes: [{ name: 'total', type: 'Money', visibility: '-', isStatic: false, defaultValue: '' }] } as never);
    expect(d.elements.find((e) => e.id === a.id)!.name).toBe('PurchaseOrder');
    const del = deleteElement(d, b2.id);
    expect(del.removedRelationships).toHaveLength(1);
    expect(validateDiagram(del.diagram).errors).toEqual([]);
    expect(() => addElement(d, 'actor')).toThrow(/cannot be added/);
    const dep = template('deployment');
    const cascade = deleteElement(dep, 'app');
    expect(cascade.removedElements.sort()).toEqual(['api', 'app', 'node']);
    expect(cascade.removedRelationships).toHaveLength(2);
  });
  it('changes relationship kinds safely and keeps positions of manually moved elements', () => {
    let d = template('class');
    const rel = d.relationships.find((r) => r.kind === 'association')!;
    d = updateRelationship(d, rel.id, { kind: 'aggregation' });
    expect(d.relationships.find((r) => r.id === rel.id)!.kind).toBe('aggregation');
    expect(() => updateRelationship(d, rel.id, { kind: 'transition' })).toThrow(/not used/);
    expect(() => updateRelationship(d, rel.id, { target: 'nope' })).toThrow(/must exist/);
    d = deleteRelationship(d, rel.id);
    expect(d.relationships.some((r) => r.id === rel.id)).toBe(false);
    d = moveElement(d, 'Course', 900, 40);
    const added = addElement(d, 'class', { name: 'Room' });
    const laid = autoLayout(added.diagram);
    expect(laid.layout.positions.Course).toEqual({ x: 900, y: 40 });
    expect(laid.layout.positions[added.id]).toBeTruthy();
    expect(autoLayout(laid, { force: true }).layout.manual).toEqual([]);
  });
  it('reorders sequence messages and supports undo / redo history', () => {
    const d = template('sequence');
    const moved = moveMessage(d, 'm2', -1);
    const order = (x: Diagram) => (x.relationships as { id: string; order: number }[]).sort((a, b) => a.order - b.order).map((m) => m.id);
    expect(order(moved).slice(0, 2)).toEqual(['m2', 'm1']);
    const h = new History(d);
    h.push(moved);
    h.push(moveMessage(moved, 'm3', -1));
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe(moved);
    expect(h.undo()).toBe(d);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(moved);
    h.push(d);
    expect(h.canRedo).toBe(false);
  });
});

// =================================================================== rendering + exports
describe('UML rendering and text exports', () => {
  it('renders the notation of every diagram type', () => {
    const svg = (t: (typeof DIAGRAM_TYPES)[number]) => toSvg(template(t)).svg;
    const c = svg('class');
    expect(c).toContain('«interface»');
    expect(c).toMatch(/font-style="italic"/); // abstract class / methods
    expect(c).toMatch(/text-decoration="underline"/); // static member
    expect(c).toContain('x-dfill'); // composition diamond
    expect(c).toContain('x-tri'); // generalization triangle
    expect(c).toContain('stroke-dasharray="7 5"'); // realization / dependency
    expect(svg('usecase')).toContain('«include»');
    expect(svg('usecase')).toMatch(/<ellipse/);
    const s = svg('sequence');
    expect(s).toContain('uml-activation');
    expect(s).toContain('>alt<');
    expect(svg('activity')).toMatch(/<rect[^>]*rx="2"[^>]*fill="#1b1f2a"/); // fork / join bar
    expect(svg('state')).toContain('entry / reserve stock');
    expect(svg('component')).toMatch(/A14,14/); // required-interface socket
    expect(svg('deployment')).toContain('«executionEnvironment»');
    expect(svg('object')).toContain('asha : Student');
    for (const t of DIAGRAM_TYPES) expect(svg(t)).toMatch(/^<\?xml[\s\S]*<svg[^>]*viewBox="0 0 \d+ \d+"/);
  });
  it('escapes user text in SVG and marks selection / errors', () => {
    let d = emptyDiagram('class');
    d = addElement(d, 'class', { id: 'x', name: '<script>alert(1)</script> & "q"' } as never).diagram;
    const out = toSvg(autoLayout(d)).svg;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    const r = render(autoLayout(d), { selected: ['x'] });
    expect(serialize(r.tree)).toContain('uml-selection');
  });
  it('never lets diagram text become markup, in any field of any diagram type (SVG injection)', () => {
    const P = '"><script>x</script><foreignObject onload="y"><a href="javascript:z">&amp;]]><!--';
    const TEXT = new Set(['name', 'label', 'title', 'stereotype', 'note', 'guard', 'event', 'action', 'className', 'value', 'type', 'returnType', 'defaultValue', 'description', 'entry', 'exit', 'doActivity', 'sourceRole', 'targetRole', 'sourceMultiplicity', 'targetMultiplicity']);
    const val = (k: string) => (k.endsWith('Multiplicity') ? P.slice(0, 20) : P.slice(0, 58));
    const poison = (v: any): any => (Array.isArray(v) ? v.map(poison) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, TEXT.has(k) && typeof x === 'string' ? val(k) : poison(x)])) : v);
    const ALLOWED = new Set(['svg', 'defs', 'marker', 'path', 'rect', 'g', 'text', 'title', 'line', 'circle', 'ellipse', 'polygon', 'polyline', 'tspan']);
    for (const t of DIAGRAM_TYPES) {
      const d0 = template(t);
      const d = parseDiagram({ ...d0, title: val('title'), elements: poison(d0.elements), relationships: poison(d0.relationships), fragments: d0.fragments.map((f) => ({ ...f, operands: f.operands.map((o) => ({ ...o, guard: val('guard') })) })) });
      const svg = toSvg(d).svg.replace(/^<\?xml[^>]*>\s*/, '');
      // tokenise: every tag must be a known SVG element whose attributes are name="value" pairs with no raw quotes or angle brackets inside
      const rest = svg.replace(/<\/?([a-zA-Z]+)((?:\s[\w:-]+="[^"<>]*")*)\s*\/?>/g, (_m, tag: string, attrs: string) => {
        expect(ALLOWED.has(tag), `${t}: <${tag}>`).toBe(true);
        for (const [, name] of attrs.matchAll(/\s([\w:-]+)="[^"]*"/g)) expect(name, t).not.toMatch(/^(on|href|xlink:href|style)/i);
        return '';
      });
      expect(rest, t).not.toMatch(/[<>]/); // nothing left that a parser could read as markup
      expect(svg).toContain('&lt;script&gt;');
    }
  });
  it('bounds coordinates: nonsensical positions are a validation error, not a broken export', async () => {
    const d = template('class');
    const bad = { ...d, layout: { ...d.layout, positions: { ...d.layout.positions, Person: { x: 1e12, y: 1e12 } } } };
    expect(safeParseDiagram(bad).ok).toBe(false);
    const r = await request(app).post('/api/uml/export/pdf').send({ model: bad, name: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_diagram');
    expect(moveElement(d, 'Person', 5e9, -5e9).layout.positions.Person).toEqual({ x: 1_000_000, y: -1_000_000 });
  });
  it('keeps labels inside element boxes (no clipping)', () => {
    const d = template('class');
    const g = geometry(d);
    for (const e of d.elements) if (e.kind === 'class') expect(g.boxes[e.id].w).toBeGreaterThanOrEqual(textWidth(e.name, 13.5, true) + 20);
  });
  it('exports PlantUML for all 8 types and Mermaid only where Mermaid has the notation', () => {
    for (const t of DIAGRAM_TYPES) {
      const p = toPlantUml(template(t));
      expect(p.startsWith('@startuml')).toBe(true);
      expect(p.trim().endsWith('@enduml')).toBe(true);
    }
    expect(toPlantUml(template('class'))).toMatch(/Person <\|-- Student/);
    expect(toPlantUml(template('sequence'))).toMatch(/alt credentials valid[\s\S]*else else[\s\S]*end/);
    expect(toMermaid(template('class'))).toMatch(/^classDiagram/);
    expect(toMermaid(template('sequence'))).toMatch(/^sequenceDiagram[\s\S]*alt credentials valid[\s\S]*else[\s\S]*end/);
    expect(toMermaid(template('state'))).toMatch(/^stateDiagram-v2[\s\S]*\[\*\] --> created/);
    for (const t of ['usecase', 'activity', 'component', 'deployment', 'object'] as const) expect(toMermaid(template(t))).toBeNull();
  });
});

// =================================================================== natural language (offline rules)
describe('Natural language → UML (rule-based, offline)', () => {
  const gen = (t: (typeof DIAGRAM_TYPES)[number], s: string) => {
    const r = generateWithRules(t, s);
    expect(r, `${t}: nothing recognised`).not.toBeNull();
    expect(validateDiagram(r!.diagram).errors).toEqual([]);
    return r!;
  };
  const names = (d: Diagram) => d.elements.map((e) => e.name).filter(Boolean);
  it('class: the library example from the specification', () => {
    const r = gen('class', 'Create a class diagram for a library management system. Include Book, Member, Librarian, Loan, and Reservation. A member can borrow multiple books. A librarian manages loans.');
    expect(names(r.diagram).sort()).toEqual(['Book', 'Librarian', 'Loan', 'Member', 'Reservation']);
    const borrow = r.diagram.relationships.find((x) => x.label === 'borrows')!;
    expect(borrow).toMatchObject({ kind: 'association', source: 'cls_Member', target: 'cls_Book', targetMultiplicity: '0..*' });
    expect(r.diagram.relationships.find((x) => x.label === 'manages')).toMatchObject({ source: 'cls_Librarian', target: 'cls_Loan' });
    expect(r.diagram.meta.generation.label).toMatch(/not AI/);
  });
  it('class: inheritance, composition, attributes and the structured notation', () => {
    const r = gen('class', 'A Car is a Vehicle. A Car consists of four Wheels. A Car has a model, color and year.');
    expect(r.diagram.relationships.map((x) => x.kind).sort()).toEqual(['composition', 'inheritance']);
    expect((r.diagram.elements.find((e) => e.name === 'Car') as { attributes: { name: string }[] }).attributes.map((a) => a.name)).toEqual(['model', 'color', 'year']);
    const s = gen('class', 'Order *-- "1..*" OrderItem : contains\nPremiumCustomer --|> Customer\nCustomer "1" --> "0..*" Order : places');
    expect(s.method).toBe('structured');
    expect(s.diagram.relationships.find((x) => x.kind === 'composition')).toMatchObject({ targetMultiplicity: '1..*', label: 'contains' });
    expect(s.diagram.relationships.find((x) => x.kind === 'inheritance')).toMatchObject({ source: 'cls_PremiumCustomer', target: 'cls_Customer' });
  });
  it('use case: actors, use cases, include and extend', () => {
    const r = gen('usecase', 'An online banking application with Customer, Administrator and Banking System as actors. Customer can view balance, transfer funds and pay bills. Administrator can manage accounts. Transfer funds includes Authenticate. Verify OTP extends Transfer funds when the amount is large.');
    expect(r.diagram.elements.filter((e) => e.kind === 'actor').map((e) => [e.name, (e as { role: string }).role])).toEqual(expect.arrayContaining([['Customer', 'primary'], ['Banking System', 'secondary']]));
    expect(r.diagram.relationships.filter((x) => x.kind === 'include')).toHaveLength(1);
    expect(r.diagram.relationships.find((x) => x.kind === 'extend')!.label).toBe('[the amount is large]');
    expect(r.diagram.elements.filter((e) => e.kind === 'usecase').every((e) => e.parent === 'system')).toBe(true);
  });
  it('sequence: participants, ordered messages, returns and self-calls', () => {
    const r = gen('sequence', 'The User enters credentials in the Frontend. The Frontend sends the credentials to the Auth API. The Auth API queries the Database for the user. The Database returns the user record to the Auth API. The Auth API validates the password. The Auth API returns a session token to the Frontend.');
    expect(names(r.diagram)).toEqual(['User', 'Frontend', 'Auth API', 'Database']);
    const m = r.diagram.relationships as { source: string; target: string; messageKind: string }[];
    expect(m.map((x) => x.messageKind)).toEqual(['sync', 'sync', 'sync', 'return', 'sync', 'return']);
    expect(m[2].target).toBe('p_Database');
    expect(m[4].source).toBe(m[4].target);
  });
  it('activity: decisions with guards, merge, fork / join', () => {
    const r = gen('activity', 'Validate the cart. If the cart is valid, process the payment, otherwise show an error. In parallel reserve stock and send a confirmation email. Then confirm the order.');
    const kinds = r.diagram.elements.map((e) => e.kind);
    for (const k of ['initial', 'decision', 'merge', 'fork', 'join', 'final']) expect(kinds).toContain(k);
    expect(r.diagram.relationships.some((x) => x.kind === 'flow' && x.guard === 'the cart is valid')).toBe(true);
    expect(names(r.diagram)).toContain('Confirm the order');
  });
  it('state: explicit transitions with events, and a plain list marked as inferred', () => {
    const t = gen('state', 'An order goes from Created to Confirmed when payment succeeds. From Confirmed to Shipped on dispatch.');
    expect(t.diagram.relationships.find((x) => x.kind === 'transition' && x.event === 'payment succeeds')).toBeTruthy();
    const l = gen('state', 'An order lifecycle containing Created, Confirmed, Processing, Shipped, Delivered, and Cancelled.');
    expect(names(l.diagram)).toEqual(['Created', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled']);
    expect(Object.values(l.diagram.meta.evidence).some((e) => e.basis === 'inferred')).toBe(true);
    expect(l.notes.join()).toMatch(/assumed/);
  });
  it('component, deployment and object descriptions', () => {
    const c = gen('component', 'A full-stack web application with Frontend, Backend API, Database and Payment Gateway. The Frontend uses the Backend API via HTTPS. The Backend API uses the Database via SQL.');
    expect(c.diagram.relationships.find((x) => x.label === 'SQL')).toMatchObject({ kind: 'dependency', source: 'cmp_Backend_API', target: 'cmp_Database' });
    const d = gen('deployment', 'The web app runs on the Browser. The Browser runs on the Client Machine. The Client Machine connects to the Application Server via HTTPS.');
    expect(d.diagram.elements.find((e) => e.name === 'Web app')).toMatchObject({ kind: 'artifact', parent: 'node_Browser' });
    expect(d.diagram.relationships[0]).toMatchObject({ kind: 'communication', label: 'HTTPS' });
    const o = gen('object', 'asha is a Student with rollNo = CS21-014 and gpa = 8.7. dsa is a Course with code = CS201. asha is enrolled in dsa.');
    expect(o.diagram.elements[0]).toMatchObject({ name: 'asha', className: 'Student', slots: [{ name: 'rollNo', value: 'CS21-014' }, { name: 'gpa', value: '8.7' }] });
    expect(o.diagram.relationships).toHaveLength(1);
  });
  it('returns null for text it cannot use (no fabricated diagram)', () => {
    expect(generateWithRules('class', 'hello there, how are you')).toBeNull();
  });
});

// =================================================================== source code
describe('Source code → UML (Tree-sitter)', () => {
  const java = `
public interface Shape { double area(); }
public abstract class Base implements Shape { protected String name; public abstract double area(); }
public class Circle extends Base { private double r; private static int COUNT = 0; public Circle(double r) { this.r = r; } public double area() { return Math.PI * r * r; } }
public class Drawing { private List<Shape> shapes = new ArrayList<>(); private Circle main = new Circle(1); public void add(Shape s) { shapes.add(s); } }`;
  const py = `
from abc import ABC, abstractmethod
class Animal(ABC):
    def __init__(self, name: str):
        self.name = name
        self._age = 0
    @abstractmethod
    def speak(self) -> str: ...
class Dog(Animal):
    sound = "woof"
    def __init__(self, name: str, owner: "Person"):
        super().__init__(name)
        self.owner = owner
        self.__chip = Chip()
    def speak(self) -> str:
        return self.sound
class Person:
    def adopt(self, d: Dog) -> None:
        pass
class Chip:
    pass`;
  it('extracts Java classes, interfaces, members, visibility and relationships with evidence', () => {
    const r = classDiagramFromSource([{ path: 'Shapes.java', content: java, language: 'java' }]);
    const el = (n: string) => r.diagram.elements.find((e) => e.name === n) as any;
    expect(el('Shape').classKind).toBe('interface');
    expect(el('Base').classKind).toBe('abstract');
    expect(el('Circle').attributes.map((a: any) => `${a.visibility}${a.name}${a.isStatic ? '$' : ''}`)).toEqual(['-r', '-COUNT$']);
    const rel = (k: string, s: string, t: string) => r.diagram.relationships.find((x) => x.kind === k && x.source === `cls_${s}` && x.target === `cls_${t}`);
    expect(rel('realization', 'Base', 'Shape')).toBeTruthy();
    expect(rel('inheritance', 'Circle', 'Base')).toBeTruthy();
    const many = rel('association', 'Drawing', 'Shape')!;
    expect(many).toMatchObject({ targetMultiplicity: '0..*', targetRole: 'shapes' });
    expect(r.diagram.meta.evidence[many.id]).toMatchObject({ basis: 'extracted', file: 'Shapes.java' });
    const comp = rel('composition', 'Drawing', 'Circle')!;
    expect(r.diagram.meta.evidence[comp.id].basis).toBe('inferred');
  });
  it('extracts Python classes, abstract methods, self attributes and visibility conventions', () => {
    const r = classDiagramFromSource([{ path: 'zoo.py', content: py, language: 'python' }]);
    const el = (n: string) => r.diagram.elements.find((e) => e.name === n) as any;
    expect(el('Animal').classKind).toBe('abstract');
    expect(el('Animal').methods.find((m: any) => m.name === 'speak')).toMatchObject({ isAbstract: true, returnType: 'str' });
    expect(el('Animal').attributes.map((a: any) => `${a.visibility}${a.name}`)).toEqual(['+name', '#_age']);
    expect(el('Dog').attributes.map((a: any) => `${a.visibility}${a.name}`)).toEqual(['+sound', '+owner', '-__chip']);
    expect(el('Dog').methods[0].params).toEqual([{ name: 'name', type: 'str' }, { name: 'owner', type: 'Person' }]); // quoted forward reference
    expect(r.diagram.relationships.some((x) => x.kind === 'inheritance' && x.source === 'cls_Dog' && x.target === 'cls_Animal')).toBe(true);
    expect(r.diagram.relationships.some((x) => x.kind === 'association' && x.source === 'cls_Dog' && x.target === 'cls_Person')).toBe(true);
    expect(r.diagram.relationships.some((x) => x.kind === 'dependency' && x.source === 'cls_Person' && x.target === 'cls_Dog')).toBe(true);
  });
  it('handles TypeScript generics, JavaScript classes, C++ pure virtual classes and C structs', () => {
    const r = classDiagramFromSource([
      { path: 'a.ts', content: 'interface Repo<T> { get(id: string): T }\nclass User {}\nclass UserRepo implements Repo<User> { private cache: Map<string, User> = new Map(); get(id: string): User { return new User(); } }', language: 'typescript' },
      { path: 'b.js', content: 'class Cart { constructor() { this.items = []; this.total = 0; } add(i) { this.items.push(i); } }\nclass Shop extends Cart {}', language: 'javascript' },
      { path: 'c.cpp', content: 'class IShape { public: virtual double area() const = 0; };\nclass Sq : public IShape { double s; public: double area() const override { return s*s; } };', language: 'cpp' },
      { path: 'd.c', content: 'struct point { int x; int y; };', language: 'c' },
    ]);
    const el = (n: string) => r.diagram.elements.find((e) => e.name === n) as any;
    expect(r.diagram.relationships.filter((x) => x.kind === 'realization').map((x) => x.target)).toEqual(['cls_Repo']); // not "User"
    expect(el('Cart').attributes.map((a: any) => a.name)).toEqual(['items', 'total']);
    expect(el('IShape').classKind).toBe('interface');
    expect(el('point')).toMatchObject({ stereotype: 'struct' });
    expect(typeHeads('Repository<Book>, Comparable<Map<K, V>>')).toEqual(['Repository', 'Comparable']);
  });
  it('builds a call sequence and an activity diagram from one method', () => {
    const ts = 'class Repo { find(id: string): Book | null { return null; } }\nclass Book {}\nclass Svc { private repo: Repo = new Repo(); lend(id: string) { const b = this.repo.find(id); if (!b) { this.fail(); } for (const x of [1, 2]) { this.repo.find(String(x)); } return b; } private fail() {} }';
    const files = [{ path: 's.ts', content: ts, language: 'typescript' }];
    const s = sequenceFromSource(files, { path: 's.ts', function: 'Svc.lend' });
    const msgs = (s.relationships as { label: string; source: string; target: string }[]).map((m) => m.label);
    expect(msgs).toEqual(['lend()', 'find(id)', 'fail()', 'find(String(x))', 'return']);
    expect(s.fragments.map((f) => f.kind)).toEqual(['opt', 'loop']);
    const a = activityFromSource(files[0], 'Svc.lend');
    expect(validateDiagram(a).errors).toEqual([]);
    expect(a.elements.filter((e) => e.kind === 'decision')).toHaveLength(2);
    expect(a.elements.some((e) => e.kind === 'action' && e.name.startsWith('return b'))).toBe(true);
  });
  it('refuses to invent diagrams from code without the needed structure', () => {
    expect(() => classDiagramFromSource([{ path: 'x.py', content: 'print(1)\n', language: 'python' }])).toThrow(/No classes/);
    expect(() => sequenceFromSource([{ path: 'x.py', content: 'def f():\n    return 1\n', language: 'python' }], { path: 'x.py', function: 'f' })).toThrow(/does not call/);
  });
});

// =================================================================== API, persistence, repository, AI
describe('UML Studio API', () => {
  let id = 0;
  it('creates, lists, opens, saves edits, renames, duplicates and deletes diagrams', async () => {
    const c = await request(app).post('/api/uml/diagrams').send({ name: 'Students', model: template('class') });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    id = c.body.data.id;
    expect(c.body.data.validation.valid).toBe(true);
    await request(app).post('/api/uml/diagrams').send({ name: 'Bad', model: { type: 'class', elements: 'nope' } }).expect(400);
    const edited = updateElement(c.body.data.model, 'Course', { name: 'Module' } as never);
    const moved = moveElement(edited, 'Course', 777, 66);
    const u = await request(app).put(`/api/uml/diagrams/${id}`).send({ model: moved, name: 'Students v2' });
    expect(u.body.data.name).toBe('Students v2');
    const g = (await request(app).get(`/api/uml/diagrams/${id}`)).body.data;
    expect(g.model.elements.find((e: any) => e.id === 'Course').name).toBe('Module');
    expect(g.model.layout.positions.Course).toEqual({ x: 777, y: 66 });
    expect(g.model.layout.manual).toContain('Course');
    await request(app).put(`/api/uml/diagrams/${id}`).send({ model: template('state') }).expect(400); // type change
    const dup = await request(app).post(`/api/uml/diagrams/${id}/duplicate`);
    expect(dup.body.data.name).toBe('Students v2 (copy)');
    const list = (await request(app).get('/api/uml/diagrams?type=class')).body.data;
    expect(list.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Students v2', 'Students v2 (copy)']));
    expect(list[0].elementCount).toBeGreaterThan(0);
    await request(app).delete(`/api/uml/diagrams/${dup.body.data.id}`).expect(200);
    await request(app).get(`/api/uml/diagrams/${dup.body.data.id}`).expect(404);
    await request(app).get('/api/uml/diagrams?type=nonsense').expect(400);
  });
  it('validates models and serves templates', async () => {
    const v = (await request(app).post('/api/uml/validate').send({ model: { ...template('usecase'), relationships: [{ id: 'q', kind: 'include', source: 'customer', target: 'login', label: '' }] } })).body.data;
    expect(v.valid).toBe(false);
    expect(v.errors[0].code).toBe('invalid-endpoint');
    expect((await request(app).get('/api/uml/templates')).body.data).toHaveLength(8);
    expect((await request(app).get('/api/uml/templates?type=state')).body.data.type).toBe('state');
  });
  it('generates offline from text and refuses text it cannot understand', async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
    const r = (await request(app).post('/api/uml/generate/text').send({ type: 'class', text: 'A member can borrow multiple books. A Librarian manages loans.' })).body.data;
    expect(r.method).toBe('rules');
    expect(r.engine.kind).toBe('offline');
    expect(r.engine.label).toMatch(/not AI/);
    expect(r.diagram.relationships.length).toBeGreaterThan(0);
    const bad = await request(app).post('/api/uml/generate/text').send({ type: 'class', text: 'lorem ipsum dolor sit amet' });
    expect(bad.status).toBe(422);
  });
  it('generates from inline source code and lists functions', async () => {
    const code = 'class A:\n    def run(self, b: "B"):\n        b.go()\nclass B:\n    def go(self):\n        pass\n';
    const c = (await request(app).post('/api/uml/generate/source').send({ code, language: 'python', kind: 'class' })).body.data;
    expect(c.diagram.elements.map((e: any) => e.name).sort()).toEqual(['A', 'B']);
    const fns = (await request(app).post('/api/uml/source/functions').send({ code, language: 'python' })).body.data;
    expect(fns[0].functions.map((f: any) => f.qualified)).toEqual(['A.run', 'B.go']);
    const s = await request(app).post('/api/uml/generate/source').send({ code, language: 'python', kind: 'sequence', function: 'A.run' });
    expect(s.body.data.diagram.relationships.map((m: any) => m.label)).toEqual(['run()', 'go()', 'return']);
  });
  it('generates repository diagrams from evidence and refuses when evidence is missing', async () => {
    const dir = writeSampleRepo(mkdtempSync(join(tmpdir(), 'cp-uml-repo-')), { 'src/lib/util.js': 'module.exports = { x: 1 };\n', 'src/api/route.js': "const u = require('../lib/util');\nconst express = require('express');\n" });
    const imp = (await request(app).post('/api/repos/import/folder').send({ path: dir })).body.data;
    for (let i = 0; i < 200 && (await request(app).get(`/api/repos/jobs/${imp.job.id}`)).body.data.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    const repoId = imp.repo.id;
    const cls = (await request(app).post('/api/uml/generate/repository').send({ repoId, kind: 'class' })).body.data;
    expect(cls.diagram.elements.map((e: any) => e.name)).toEqual(expect.arrayContaining(['helper', 'Main']));
    expect(cls.diagram.meta.generation.repoId).toBe(repoId);
    const mods = (await request(app).post('/api/uml/generate/repository').send({ repoId, kind: 'modules', folder: 'src' })).body.data;
    expect(mods.diagram.relationships.some((r: any) => r.source === 'mod_api' && r.target === 'mod_lib')).toBe(true);
    expect(mods.diagram.elements.some((e: any) => e.name === 'express' && e.stereotype === 'library')).toBe(true);
    const arch = (await request(app).post('/api/uml/generate/repository').send({ repoId, kind: 'architecture' })).body.data;
    expect(arch.diagram.elements.map((e: any) => e.name)).toEqual(expect.arrayContaining(['Frontend', 'Backend API']));
    // the sample has Express + React but no container config: deployment is derived with low-confidence hosting
    const dep = (await request(app).post('/api/uml/generate/repository').send({ repoId, kind: 'deployment' })).body.data;
    expect(dep.warnings.join()).toMatch(/No container configuration/);
    // a folder with nothing to go on is refused rather than invented
    const empty = mkdtempSync(join(tmpdir(), 'cp-uml-empty-'));
    writeFileSync(join(empty, 'notes.py'), 'print(1)\n');
    const imp2 = (await request(app).post('/api/repos/import/folder').send({ path: empty })).body.data;
    for (let i = 0; i < 200 && (await request(app).get(`/api/repos/jobs/${imp2.job.id}`)).body.data.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    const refused = await request(app).post('/api/uml/generate/repository').send({ repoId: imp2.repo.id, kind: 'deployment' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/would have to be invented/);
    // saved diagrams can be linked to the repository
    const saved = await request(app).post('/api/uml/diagrams').send({ name: 'Repo classes', model: cls.diagram });
    expect(saved.body.data.repoId).toBe(repoId);
    expect((await request(app).get(`/api/uml/diagrams?repoId=${repoId}`)).body.data).toHaveLength(1);
    // removing the repository keeps the diagram (the link is cleared, ON DELETE SET NULL)
    await request(app).delete(`/api/repos/${repoId}?confirm=yes`).expect(200);
    const kept = (await request(app).get(`/api/uml/diagrams/${saved.body.data.id}`)).body.data;
    expect(kept.repoId).toBeNull();
    expect(kept.model.elements.length).toBeGreaterThan(0);
  });
  it('reads docker-compose services for deployment diagrams', () => {
    const s = parseComposeServices('services:\n  web:\n    build: .\n    ports:\n      - "8080:80"\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n');
    expect(s).toEqual([
      { name: 'web', image: '', build: '.', ports: ['8080:80'], dependsOn: ['db'], line: 2 },
      { name: 'db', image: 'postgres:16', build: '', ports: [], dependsOn: [], line: 8 },
    ]);
  });
  it.runIf(!!findBrowser())('exports a vector PDF of a diagram', async () => {
    const r = await request(app).post('/api/uml/export/pdf').send({ model: template('component'), name: 'arch' }).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/arch\.pdf/);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 90_000);
});

// =================================================================== AI generation (Ollama protocol stub)
describe('UML generation with local AI (stub)', () => {
  let server: Server;
  let url = '';
  const prompts: string[] = [];
  let calls = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'stub' }));
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: ['uml', 'dangling', 'garbage'].map((n) => ({ name: `${n}:latest`, size: 1e9, details: {} })) }));
        const p = JSON.parse(body);
        prompts.push(p.prompt);
        calls++;
        const send = (t: string) => {
          res.setHeader('content-type', 'application/x-ndjson');
          res.write(JSON.stringify({ response: t, done: false }) + '\n');
          res.end(JSON.stringify({ response: '', done: true }));
        };
        if (p.model === 'garbage:latest') return send('Here is your diagram!');
        const good = { title: 'Library', classes: [{ name: 'Member', kind: 'class', attributes: [{ name: 'name', type: 'String', visibility: 'private' }], methods: [{ name: 'borrow', parameters: 'book: Book', returnType: 'Loan', visibility: 'public' }] }, { name: 'Book', kind: 'class', attributes: [], methods: [] }, { name: 'Loan', kind: 'class', attributes: [], methods: [] }], relationships: [{ from: 'Member', to: 'Book', type: 'association', label: 'borrows', fromMultiplicity: '1', toMultiplicity: '0..*' }, { from: 'Loan', to: 'Book', type: 'association', label: '', fromMultiplicity: '', toMultiplicity: '' }] };
        if (p.model === 'dangling:latest') {
          // first answer references an undefined class; after the repair prompt it is fixed
          if (!/previous answer had these problems/.test(p.prompt)) return send(JSON.stringify({ ...good, relationships: [...good.relationships, { from: 'Librarian', to: 'Loan', type: 'association', label: 'manages', fromMultiplicity: '', toMultiplicity: '' }] }));
          return send(JSON.stringify({ ...good, classes: [...good.classes, { name: 'Librarian', kind: 'class', attributes: [], methods: [] }], relationships: [...good.relationships, { from: 'Librarian', to: 'Loan', type: 'association', label: 'manages', fromMultiplicity: '', toMultiplicity: '' }] }));
        }
        return send(JSON.stringify(good));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
    server.close();
  });
  const use = async (model: string) => {
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: url, ollamaModel: model, aiTimeoutSec: 15 });
    clearStatusCache();
  };
  it('produces a validated diagram from the model, labelled as Local AI, with the prompt redacted', async () => {
    await use('uml:latest');
    prompts.length = 0;
    const secret = 'sk_live_' + 'abcdefghijklmnopqrstuvwx';
    const r = (await request(app).post('/api/uml/generate/text').send({ type: 'class', text: `A library where members borrow books. api key ${secret}` })).body.data;
    expect(r.method).toBe('ai');
    expect(r.engine.kind).toBe('ollama');
    expect(r.validation.valid).toBe(true);
    expect(r.diagram.elements.map((e: any) => e.name)).toEqual(['Member', 'Book', 'Loan']);
    expect(r.diagram.elements[0].methods[0]).toMatchObject({ name: 'borrow', params: [{ name: 'book', type: 'Book' }], returnType: 'Loan' });
    expect(r.diagram.meta.evidence.cls_Member.basis).toBe('ai');
    expect(prompts.join()).not.toContain(secret);
    expect(prompts[0]).toContain('UML class diagram');
  });
  it('repairs an answer with undefined references in one bounded extra round', async () => {
    await use('dangling:latest');
    calls = 0;
    const r = (await request(app).post('/api/uml/generate/text').send({ type: 'class', text: 'A librarian manages loans of books.' })).body.data;
    expect(calls).toBe(2);
    expect(r.repaired).toBe(true);
    expect(r.diagram.elements.map((e: any) => e.name)).toContain('Librarian');
    expect(r.warnings).toEqual([]);
  });
  it('reports (never silently drops) unresolved references', () => {
    const { diagram, problems } = convertAi('class', { title: '', classes: [{ name: 'A', kind: 'class', attributes: [], methods: [] }], relationships: [{ from: 'A', to: 'Ghost', type: 'dependency', label: '', fromMultiplicity: '', toMultiplicity: '' }] }, 'x');
    expect(problems).toEqual(['A dependency relationship refers to "Ghost", which is not defined.']);
    expect(diagram.relationships).toHaveLength(0);
  });
  it('falls back to the offline generator when the model returns malformed output', async () => {
    await use('garbage:latest');
    const r = (await request(app).post('/api/uml/generate/text').send({ type: 'class', text: 'A member can borrow multiple books.' })).body.data;
    expect(r.method).toBe('rules');
    expect(r.engine.kind).toBe('offline');
    expect(r.warnings[0]).toMatch(/could not produce a valid diagram/);
  });
  it('falls back to offline generation when Ollama is unreachable', async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'x' });
    clearStatusCache();
    const r = (await request(app).post('/api/uml/generate/text').send({ type: 'state', text: 'from Draft to Published when approved' })).body.data;
    expect(r.method).toBe('rules');
    expect(r.engine.notice).toMatch(/not running|not reachable|not installed/i);
  });
});

void mkdirSync;
void ELEMENT_KINDS;
void RELATIONSHIP_KINDS;
