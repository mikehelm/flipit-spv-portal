import { joinRegisterAction, leaveRegisterAction } from '@/actions/register'
import { ActionForm } from '@/components/admin/action-form'
import {
  INDICATIVE_AMOUNT_LABEL,
  JOIN_BUTTON_LABEL,
  JOINED_CONFIRMATION,
  LEAVE_BUTTON_LABEL,
  REGISTER_COPY,
  REGISTER_TITLE,
} from '@/lib/register/copy'
import type { InvestorRegisterView } from '@/lib/register/data'

/**
 * The register of interest, on the investor's side. BUILD_SPEC §5.2.1.
 *
 * The four paragraphs are rendered from `REGISTER_COPY` rather than typed here,
 * and a test compares that constant to the blockquote in the specification. The
 * spec is unusually firm about it — "the whole feature lives or dies on not
 * overstating" — so the wording is not something a component gets to paraphrase.
 *
 * What is not on this page, and has nowhere to come from: a position, a rank, a
 * number of people on the register, or anybody else's name. §5.2.2 forbids all
 * of it, and `InvestorRegisterView` has no field that could carry one.
 */
export function RegisterSection({ view }: { view: InvestorRegisterView }) {
  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold text-white">{REGISTER_TITLE}</h2>

      <div className="mt-4 rounded-sm border hairline bg-[#14162f] p-5">
        {REGISTER_COPY.map((paragraph, index) => (
          <p
            key={paragraph.slice(0, 24)}
            className={`text-sm leading-relaxed ${
              index === 0 ? 'text-[#e7e9f5]' : 'mt-3 text-[#9498b5]'
            }`}
          >
            {paragraph}
          </p>
        ))}

        {view.onRegister ? (
          <div className="mt-5 border-t hairline pt-5">
            <p className="text-sm leading-relaxed text-[#35d07f]">{JOINED_CONFIRMATION}</p>

            {view.indicativeAmount ? (
              <p className="mt-2 text-xs leading-relaxed text-[#9498b5]">
                You said roughly {view.indicativeAmount} would interest you. That is indicative
                only and nothing is held on the basis of it.
              </p>
            ) : null}

            {view.canChange ? (
              <div className="mt-4">
                <ActionForm
                  action={leaveRegisterAction}
                  submitLabel={LEAVE_BUTTON_LABEL}
                  tone="quiet"
                />
              </div>
            ) : null}
          </div>
        ) : view.canChange ? (
          <div className="mt-5 border-t hairline pt-5">
            <ActionForm action={joinRegisterAction} submitLabel={JOIN_BUTTON_LABEL}>
              <label
                htmlFor="indicativeAmount"
                className="block text-xs leading-relaxed text-[#9498b5]"
              >
                {INDICATIVE_AMOUNT_LABEL}
              </label>
              <input
                id="indicativeAmount"
                name="indicativeAmount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Optional"
                className="mt-2 w-full rounded-sm border hairline bg-[#0d0f2e] px-3 py-2.5 text-sm text-[#e7e9f5] placeholder:text-[#6c7290] focus:border-[#F59A23] focus:outline-none"
              />
            </ActionForm>
          </div>
        ) : (
          <p className="mt-5 border-t hairline pt-5 text-sm leading-relaxed text-[#9498b5]">
            The register cannot be changed at this time.
          </p>
        )}
      </div>
    </section>
  )
}
