import { askQuestionAction } from '@/actions/qa'
import { ActionForm } from '@/components/admin/action-form'
import type { InvestorQaView } from '@/lib/qa/data'

/**
 * The investor's Q&A. BUILD_SPEC §6.7, copy from PORTAL_COPY.
 *
 * Three parts, and the order matters: the box to ask, the shared answers, then
 * their own thread. Someone arriving with a question should meet the form
 * before they meet a wall of other people's answers.
 *
 * Nothing rendered here carries an asker, a count, a date more precise than a
 * month, or any wording implying other participants beyond what the shared
 * section unavoidably implies — which is exactly why §6.7.5 gives the owner a
 * switch to turn it off during the raise.
 *
 * A server component. It renders what `loadInvestorQa` handed it and has no
 * way to reach anything else.
 */

function SharedEntry({
  question,
  answer,
  pinned,
  publishedPeriod,
  updatedPeriod,
}: {
  question: string
  answer: string
  pinned: boolean
  publishedPeriod: string | null
  updatedPeriod: string | null
}) {
  return (
    <li className="rounded-sm border hairline bg-[#14162f] p-4 sm:p-5">
      {pinned ? (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#F59A23]">
          Start here
        </p>
      ) : null}
      <p className="text-sm font-semibold leading-relaxed text-white">{question}</p>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[#cbd1de]">
        {answer}
      </p>
      {publishedPeriod ? (
        <p className="mt-3 text-xs text-[#6c7290]">
          Answered {publishedPeriod}
          {updatedPeriod ? ` · updated ${updatedPeriod}` : ''}
        </p>
      ) : null}
    </li>
  )
}

export function QaSection({ view }: { view: InvestorQaView }) {
  if (!view.canReadOwn && !view.canAsk) return null

  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold text-white">Questions and answers</h2>

      {view.canAsk ? (
        <div className="mt-4 rounded-sm border hairline bg-[#14162f] p-5">
          <p className="text-sm leading-relaxed text-[#cbd1de]">
            Have a question about the SPV, the structure, or your allocation? Ask it here and
            David will come back to you by email. You&rsquo;ll also see his answer on this
            page.
          </p>

          <div className="mt-4">
            <ActionForm action={askQuestionAction} submitLabel="Send my question">
              <label htmlFor="qa-body" className="sr-only">
                Your question
              </label>
              <textarea
                id="qa-body"
                name="body"
                rows={4}
                required
                placeholder="What would you like to know?"
                className="w-full rounded-sm border hairline bg-[#0d0f2e] px-3 py-2.5 text-sm text-[#e7e9f5] placeholder:text-[#6c7290] focus:border-[#F59A23] focus:outline-none"
              />
            </ActionForm>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-[#9498b5]">
          Questions are not being accepted at this time. Your previous questions and their
          answers remain below.
        </p>
      )}

      {view.sharedState === 'VISIBLE' ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-white">Common questions</h3>
          <p className="mt-2 text-xs leading-relaxed text-[#9498b5]">
            Questions other people have asked, answered by David. Names are never shown — if
            you ask something here, nobody else sees that it came from you.
          </p>

          {view.shared.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-[#9498b5]">
              No shared questions yet. If you have one, ask above.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {view.shared.map((entry) => (
                <SharedEntry
                  key={entry.id}
                  question={entry.question}
                  answer={entry.answer}
                  pinned={entry.pinned}
                  publishedPeriod={entry.publishedPeriod}
                  updatedPeriod={entry.updatedPeriod}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {view.canReadOwn && view.own.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-white">Your own questions</h3>
          <p className="mt-2 text-xs leading-relaxed text-[#9498b5]">
            Your questions and David&rsquo;s replies to you. These are private to you unless
            David marks an answer as generally useful, in which case the question appears in
            Common questions above with your name removed.
          </p>

          <ul className="mt-4 grid gap-3">
            {view.own.map((thread) => (
              <li
                key={thread.entryId}
                className="rounded-sm border hairline bg-[#14162f] p-4 sm:p-5"
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">
                  {thread.question}
                </p>

                {thread.answer ? (
                  <div className="mt-4 border-l-2 border-[#35d07f] pl-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#6c7290]">
                      David&rsquo;s reply
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#cbd1de]">
                      {thread.answer}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-[#9498b5]">
                    Sent to David. He will get back to you by email, and the answer will
                    appear here too.
                  </p>
                )}

                {view.canAsk ? (
                  <div className="mt-4">
                    <ActionForm
                      action={askQuestionAction}
                      submitLabel="Add to this question"
                      tone="quiet"
                      hidden={{ entryId: thread.entryId }}
                    >
                      <label htmlFor={`followup-${thread.entryId}`} className="sr-only">
                        Add to this question
                      </label>
                      <textarea
                        id={`followup-${thread.entryId}`}
                        name="body"
                        rows={3}
                        required
                        placeholder="Anything else on this?"
                        className="w-full rounded-sm border hairline bg-[#0d0f2e] px-3 py-2.5 text-sm text-[#e7e9f5] placeholder:text-[#6c7290] focus:border-[#F59A23] focus:outline-none"
                      />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
