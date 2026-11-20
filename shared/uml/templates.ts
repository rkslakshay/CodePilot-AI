/**
 * Starter diagrams (one per type) — editable starting points, labelled "template" in the UI.
 * They are not the generation mechanism: generation uses the model, rules, source code or repositories.
 */
import { emptyDiagram, makeElement, makeRelationship } from './ops.js';
import { autoLayout } from './layout.js';
import type { Diagram, DiagramElement, DiagramType, Fragment, Relationship, RelationshipKind } from './model.js';

/** Small builder that keeps template / generator code readable. */
export class DiagramBuilder {
  d: Diagram;
  constructor(type: DiagramType, title = '') {
    this.d = emptyDiagram(type, title);
  }
  el(id: string, kind: DiagramElement['kind'], name: string, props: Record<string, unknown> = {}): string {
    this.d.elements.push(makeElement(kind, { id, name, ...props } as Partial<DiagramElement>));
    return id;
  }
  rel(kind: RelationshipKind, source: string, target: string, props: Record<string, unknown> = {}): string {
    const id = (props.id as string) ?? `r${this.d.relationships.length + 1}`;
    this.d.relationships.push(makeRelationship(kind, source, target, { ...props, id } as Partial<Relationship>));
    return id;
  }
  msg(source: string, target: string, label: string, messageKind: 'sync' | 'async' | 'return' | 'create' = 'sync'): number {
    const order = this.d.relationships.filter((r) => r.kind === 'message').length;
    this.rel('message', source, target, { label, messageKind, order, id: `m${order + 1}` });
    return order;
  }
  frag(kind: Fragment['kind'], operands: Fragment['operands']) {
    this.d.fragments.push({ id: `f${this.d.fragments.length + 1}`, kind, operands });
  }
  build(method: Diagram['meta']['generation']['method'] = 'template', label = 'Starter template'): Diagram {
    this.d.meta.generation = { method, label, warnings: [] };
    return autoLayout(this.d, { force: true });
  }
}

const attr = (name: string, type: string, visibility = '-', extra: Record<string, unknown> = {}) => ({ name, type, visibility, isStatic: false, defaultValue: '', ...extra });
const op = (name: string, returnType = '', params: [string, string][] = [], extra: Record<string, unknown> = {}) => ({ name, returnType, params: params.map(([n, t]) => ({ name: n, type: t })), visibility: '+', isStatic: false, isAbstract: false, ...extra });

export function template(type: DiagramType): Diagram {
  switch (type) {
    case 'class': {
      const b = new DiagramBuilder('class', 'Student management system');
      b.el('Person', 'class', 'Person', { classKind: 'abstract', attributes: [attr('id', 'int', '#'), attr('name', 'String', '#'), attr('email', 'String', '#')], methods: [op('getContact', 'String', [], { isAbstract: true })] });
      b.el('Student', 'class', 'Student', { attributes: [attr('rollNo', 'String'), attr('gpa', 'double')], methods: [op('enroll', 'Enrollment', [['course', 'Course']]), op('getContact', 'String')] });
      b.el('Teacher', 'class', 'Teacher', { attributes: [attr('employeeId', 'String'), attr('salary', 'double')], methods: [op('assignGrade', 'void', [['e', 'Enrollment'], ['grade', 'String']]), op('getContact', 'String')] });
      b.el('Course', 'class', 'Course', { attributes: [attr('code', 'String'), attr('title', 'String'), attr('credits', 'int'), attr('MAX_SEATS', 'int', '+', { isStatic: true, defaultValue: '60' })], methods: [op('hasSeat', 'boolean')] });
      b.el('Department', 'class', 'Department', { attributes: [attr('name', 'String')], methods: [op('addCourse', 'void', [['c', 'Course']])] });
      b.el('Enrollment', 'class', 'Enrollment', { attributes: [attr('enrolledOn', 'Date'), attr('grade', 'String')], methods: [] });
      b.el('Gradable', 'class', 'Gradable', { classKind: 'interface', methods: [op('assignGrade', 'void', [['e', 'Enrollment'], ['grade', 'String']], { isAbstract: true })] });
      b.rel('inheritance', 'Student', 'Person');
      b.rel('inheritance', 'Teacher', 'Person');
      b.rel('realization', 'Teacher', 'Gradable');
      b.rel('composition', 'Department', 'Course', { sourceMultiplicity: '1', targetMultiplicity: '1..*', label: 'offers' });
      b.rel('association', 'Student', 'Enrollment', { sourceMultiplicity: '1', targetMultiplicity: '0..*', navigable: true });
      b.rel('association', 'Enrollment', 'Course', { sourceMultiplicity: '0..*', targetMultiplicity: '1', navigable: true });
      b.rel('aggregation', 'Department', 'Teacher', { sourceMultiplicity: '1', targetMultiplicity: '1..*', label: 'employs' });
      b.rel('dependency', 'Teacher', 'Enrollment', { label: 'grades' });
      return b.build();
    }
    case 'usecase': {
      const b = new DiagramBuilder('usecase', 'Online banking');
      b.el('customer', 'actor', 'Customer', { role: 'primary' });
      b.el('admin', 'actor', 'Administrator', { role: 'primary' });
      b.el('bank', 'actor', 'Banking System', { role: 'secondary' });
      b.el('sys', 'boundary', 'Online Banking Application');
      const uc = (id: string, n: string) => b.el(id, 'usecase', n, { parent: 'sys' });
      uc('login', 'Log in');
      uc('balance', 'View balance');
      uc('transfer', 'Transfer funds');
      uc('pay', 'Pay bills');
      uc('auth', 'Authenticate');
      uc('otp', 'Verify OTP');
      uc('manage', 'Manage accounts');
      b.rel('association', 'customer', 'login');
      b.rel('association', 'customer', 'balance');
      b.rel('association', 'customer', 'transfer');
      b.rel('association', 'customer', 'pay');
      b.rel('association', 'admin', 'manage');
      b.rel('association', 'admin', 'login');
      b.rel('association', 'transfer', 'bank');
      b.rel('association', 'pay', 'bank');
      b.rel('include', 'login', 'auth');
      b.rel('include', 'transfer', 'auth');
      b.rel('extend', 'otp', 'transfer', { label: '[amount > limit]' });
      return b.build();
    }
    case 'sequence': {
      const b = new DiagramBuilder('sequence', 'User sign-in');
      b.el('user', 'participant', 'User', { participantType: 'actor' });
      b.el('ui', 'participant', 'Frontend', { participantType: 'boundary' });
      b.el('api', 'participant', 'Auth API', { participantType: 'control' });
      b.el('db', 'participant', 'Database', { participantType: 'database' });
      b.msg('user', 'ui', 'enter email + password');
      b.msg('ui', 'api', 'POST /login');
      b.msg('api', 'api', 'validate input');
      const q = b.msg('api', 'db', 'findUser(email)');
      b.msg('db', 'api', 'user record', 'return');
      const ok = b.msg('api', 'api', 'verify password hash');
      b.msg('api', 'ui', '200 + session token', 'return');
      const bad = b.msg('api', 'ui', '401 invalid credentials', 'return');
      b.msg('ui', 'user', 'show result', 'async');
      b.frag('alt', [
        { guard: 'credentials valid', from: ok, to: ok + 1 },
        { guard: 'else', from: bad, to: bad },
      ]);
      void q;
      return b.build();
    }
    case 'activity': {
      const b = new DiagramBuilder('activity', 'E-commerce checkout');
      b.el('start', 'initial', '');
      b.el('validate', 'action', 'Validate cart');
      b.el('valid', 'decision', '');
      b.el('fork', 'fork', '');
      b.el('pay', 'action', 'Process payment');
      b.el('stock', 'action', 'Reserve stock');
      b.el('join', 'join', '');
      b.el('paid', 'decision', '');
      b.el('confirm', 'action', 'Confirm order');
      b.el('email', 'action', 'Send confirmation email');
      b.el('fail', 'action', 'Show error and release stock');
      b.el('fix', 'action', 'Ask user to fix cart');
      b.el('merge', 'merge', '');
      b.el('end', 'final', '');
      b.rel('flow', 'start', 'validate');
      b.rel('flow', 'validate', 'valid');
      b.rel('flow', 'valid', 'fork', { guard: 'cart valid' });
      b.rel('flow', 'valid', 'fix', { guard: 'invalid' });
      b.rel('flow', 'fork', 'pay');
      b.rel('flow', 'fork', 'stock');
      b.rel('flow', 'pay', 'join');
      b.rel('flow', 'stock', 'join');
      b.rel('flow', 'join', 'paid');
      b.rel('flow', 'paid', 'confirm', { guard: 'payment ok' });
      b.rel('flow', 'paid', 'fail', { guard: 'payment failed' });
      b.rel('flow', 'confirm', 'email');
      b.rel('flow', 'email', 'merge');
      b.rel('flow', 'fail', 'merge');
      b.rel('flow', 'fix', 'merge');
      b.rel('flow', 'merge', 'end');
      return b.build();
    }
    case 'state': {
      const b = new DiagramBuilder('state', 'Order lifecycle');
      b.el('i', 'initial', '');
      b.el('created', 'state', 'Created', { entry: 'reserve stock' });
      b.el('confirmed', 'state', 'Confirmed');
      b.el('processing', 'state', 'Processing', { doActivity: 'pick & pack' });
      b.el('shipped', 'state', 'Shipped');
      b.el('delivered', 'state', 'Delivered');
      b.el('cancelled', 'state', 'Cancelled', { entry: 'refund payment' });
      b.el('f', 'final', '');
      b.rel('transition', 'i', 'created');
      b.rel('transition', 'created', 'confirmed', { event: 'pay', guard: 'payment ok' });
      b.rel('transition', 'created', 'cancelled', { event: 'cancel' });
      b.rel('transition', 'confirmed', 'processing', { event: 'startFulfilment' });
      b.rel('transition', 'confirmed', 'cancelled', { event: 'cancel', action: 'refund' });
      b.rel('transition', 'processing', 'shipped', { event: 'dispatch' });
      b.rel('transition', 'shipped', 'shipped', { event: 'trackingUpdate' });
      b.rel('transition', 'shipped', 'delivered', { event: 'deliver' });
      b.rel('transition', 'delivered', 'f');
      b.rel('transition', 'cancelled', 'f');
      return b.build();
    }
    case 'component': {
      const b = new DiagramBuilder('component', 'Full-stack web application');
      b.el('web', 'component', 'Web Frontend', { stereotype: 'React SPA' });
      b.el('api', 'component', 'Backend API', { stereotype: 'Express' });
      b.el('auth', 'component', 'Authentication Service');
      b.el('db', 'component', 'Database', { stereotype: 'PostgreSQL' });
      b.el('pay', 'component', 'Payment Gateway', { stereotype: 'external' });
      b.el('mail', 'component', 'Email Provider', { stereotype: 'external' });
      b.el('rest', 'interface', 'REST API');
      b.el('iauth', 'interface', 'IAuth');
      b.rel('provides', 'api', 'rest');
      b.rel('requires', 'web', 'rest');
      b.rel('provides', 'auth', 'iauth');
      b.rel('requires', 'api', 'iauth');
      b.rel('dependency', 'api', 'db', { label: 'SQL' });
      b.rel('dependency', 'api', 'pay', { label: 'HTTPS' });
      b.rel('dependency', 'auth', 'mail', { label: 'SMTP' });
      return b.build();
    }
    case 'deployment': {
      const b = new DiagramBuilder('deployment', 'Web application deployment');
      b.el('client', 'node', 'Client machine', { nodeType: 'device' });
      b.el('browser', 'node', 'Web browser', { nodeType: 'executionEnvironment', parent: 'client' });
      b.el('spa', 'artifact', 'bundle.js', { parent: 'browser' });
      b.el('app', 'node', 'Application server', { nodeType: 'device' });
      b.el('node', 'node', 'Node.js 22', { nodeType: 'executionEnvironment', parent: 'app' });
      b.el('api', 'artifact', 'api-server.js', { parent: 'node' });
      b.el('dbs', 'node', 'Database server', { nodeType: 'device' });
      b.el('pg', 'node', 'PostgreSQL 16', { nodeType: 'executionEnvironment', parent: 'dbs' });
      b.el('schema', 'artifact', 'schema.sql', { parent: 'pg' });
      b.rel('communication', 'client', 'app', { label: 'HTTPS' });
      b.rel('communication', 'app', 'dbs', { label: 'TCP/5432' });
      return b.build();
    }
    case 'object': {
      const b = new DiagramBuilder('object', 'University snapshot');
      b.el('asha', 'object', 'asha', { className: 'Student', slots: [{ name: 'rollNo', value: '"CS21-014"' }, { name: 'gpa', value: '8.7' }] });
      b.el('ravi', 'object', 'ravi', { className: 'Student', slots: [{ name: 'rollNo', value: '"CS21-031"' }, { name: 'gpa', value: '7.9' }] });
      b.el('dsa', 'object', 'dsa', { className: 'Course', slots: [{ name: 'code', value: '"CS201"' }, { name: 'credits', value: '4' }] });
      b.el('e1', 'object', 'e1', { className: 'Enrollment', slots: [{ name: 'grade', value: '"A"' }] });
      b.el('e2', 'object', 'e2', { className: 'Enrollment', slots: [{ name: 'grade', value: '"B+"' }] });
      b.el('cs', 'object', 'cse', { className: 'Department', slots: [{ name: 'name', value: '"Computer Science"' }] });
      b.rel('link', 'asha', 'e1', { label: 'enrolls' });
      b.rel('link', 'ravi', 'e2', { label: 'enrolls' });
      b.rel('link', 'e1', 'dsa');
      b.rel('link', 'e2', 'dsa');
      b.rel('link', 'cs', 'dsa', { label: 'offers' });
      return b.build();
    }
  }
}
