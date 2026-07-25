/**
 * The shape every admin server action returns.
 *
 * Errors say what happened and what to do — a blocked or refused action never
 * comes back as "something went wrong". Specifics that are not for the browser
 * go to the audit log instead.
 */

export type FieldErrors = Record<string, string>

export type ActionState =
  | { status: 'idle' }
  | {
      status: 'ok'
      message: string
      /**
       * A value shown exactly once and never stored anywhere it could be read
       * again — currently only a freshly issued operator invite token.
       */
      revealOnce?: string
    }
  | { status: 'error'; message: string; fieldErrors?: FieldErrors }

export const idleState: ActionState = { status: 'idle' }

export function actionError(message: string, fieldErrors?: FieldErrors): ActionState {
  return { status: 'error', message, fieldErrors }
}

export function actionOk(message: string, revealOnce?: string): ActionState {
  return { status: 'ok', message, revealOnce }
}
