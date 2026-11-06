/**
 * Committed live lines from the real Nemotron 3.5 streaming engine (q8_0, live latency, no
 * diarization) over synthesized meeting audio (Windows SAPI es-MX and en-US voices), 2026-11-06.
 * Names are anonymized. `question` is what a person in the room would expect: a direct question
 * that wants an answer. Rhetorical checks and statements are false.
 *
 * Lines are from the `es-US` / `en-US` locales. Findings: with `es-US` the engine wrote no `?` or
 * `¿` at all (with `auto`, one question of six); in English it ended half of the questions with
 * `?` and left the others bare ("What's the budget for Q three").
 */
export interface LiveLineFixture {
  readonly line: string;
  readonly question: boolean;
}

export const NEMOTRON_ES_LINES: readonly LiveLineFixture[] = [
  { line: '[00:00.32-00:01.28] Buenos días a todos,', question: false },
  { line: '[00:02.00-00:04.00] empecemos la reunión de seguimiento del proyecto', question: false },
  {
    line: '[00:06.72-00:09.92] la semana pasada cerramos la integración con el sistema de pagos',
    question: false,
  },
  { line: '[00:12.16-00:14.40] cuando entregamos el informe final al cliente', question: true },
  {
    line: '[00:16.64-00:18.88] Creo que deberíamos tenerlo listo para el viernes.',
    question: false,
  },
  { line: '[00:21.44-00:21.76] Se entiende', question: false },
  { line: '[00:24.16-00:25.76] puedes enviarme el contrato mañana', question: true },
  {
    line: '[00:28.16-00:32.48] El equipo de diseño terminó las pantallas nuevas porque el cliente las pidió con urgencia',
    question: false,
  },
  { line: '[00:34.96-00:35.04] Ok', question: false },
  {
    line: '[00:42.24-00:45.28] revisamos los números con finanzas y estamos bien encaminados',
    question: false,
  },
  {
    line: '[00:47.68-00:49.60] quien se encarga de las pruebas de rendimiento',
    question: true,
  },
  {
    line: '[00:52.16-00:54.32] por qué se retrasó la migración de la base de datos',
    question: true,
  },
  {
    line: '[01:01.92-01:04.16] tenemos que hablar con ellos esta misma semana',
    question: false,
  },
  { line: '[01:05.12-01:06.80] alguien puede organizar esa llamada', question: true },
  { line: '[01:08.16-01:08.32] gracias', question: false },
  { line: '[01:10.72-01:10.80] verdad', question: false },
  {
    line: '[01:13.12-01:16.32] vamos a cerrar con los próximos pasos y nos vemos el lunes',
    question: false,
  },
];

export const NEMOTRON_EN_LINES: readonly LiveLineFixture[] = [
  { line: '[00:00.32-00:01.20] Good morning everyone.', question: false },
  { line: "[00:01.84-00:03.84] Let's get started with the weekly sink", question: false },
  {
    line: '[00:05.84-00:08.64] Last week we shipped the new onboarding flow to all users',
    question: false,
  },
  { line: "[00:10.96-00:12.56] What's the budget for Q three", question: true },
  {
    line: '[00:14.88-00:17.12] finance told us the numbers will be ready by Thursday',
    question: false,
  },
  { line: '[00:19.36-00:20.88] Can you share the deck after the call?', question: true },
  {
    line: '[00:23.12-00:27.12] The marketing team is waiting on the final copy because legal still has comments',
    question: false,
  },
  { line: '[00:29.76-00:29.84] right', question: false },
  { line: '[00:32.08-00:33.76] How long will the security review take?', question: true },
  { line: '[00:36.00-00:37.68] We need to plan the release around it', question: false },
  { line: '[00:40.00-00:42.08] Is the staging environment ready for testing', question: true },
  { line: '[00:44.56-00:44.64] okay', question: false },
  {
    line: '[00:46.80-00:49.04] Who owns the customer escalation from Monday?',
    question: true,
  },
  {
    line: '[00:51.28-00:53.92] I think Alex picked it up, but let me double check.',
    question: false,
  },
  { line: '[00:55.12-00:56.64] Do we have a timeline for the fix', question: true },
  { line: '[00:58.00-00:58.24] Thanks', question: false },
  { line: '[01:00.56-01:01.36] Does that make sense', question: false },
  {
    line: "[01:03.76-01:06.24] Let's wrap up with action items and meet again next week",
    question: false,
  },
];
