import { previewOffer, type CartState } from '@ravin-sales/domain';
import { Price } from '../../components/Price.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { ACTIVE_OFFER, PRICING } from '../../config/demo.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatMoney } from '../../lib/format.ts';

interface OfferSheetProps {
  readonly cart: CartState;
  readonly onApply: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

/**
 * Shows the total with and without the offer before the seller applies it, because paying the two
 * most expensive pieces at the sale price can cost more than the regular 30%.
 */
export function OfferSheet({ cart, onApply, onRemove, onClose }: OfferSheetProps) {
  const { t } = useI18n();
  const preview = previewOffer(cart.units, PRICING, ACTIVE_OFFER);
  const active = cart.offer !== null;
  const hasNewerPieces = active && cart.units.some((unit) => unit.seq > cart.offer!.appliedAtSeq);

  const footer = preview.applicable ? (
    <>
      {!active || hasNewerPieces ? (
        <button
          type="button"
          onClick={onApply}
          className="min-h-13 rounded-2xl bg-accent px-4 text-base font-semibold text-accent-fg"
        >
          {active ? t.reapplyOffer : t.applyOffer}
        </button>
      ) : null}
      {active ? (
        <button
          type="button"
          onClick={onRemove}
          className="min-h-12 rounded-2xl border-2 border-line px-4 text-base font-semibold"
        >
          {t.removeOffer}
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <Sheet
      title={t.offerName(ACTIVE_OFFER.buyQty, ACTIVE_OFFER.payQty)}
      subtitle={active ? t.offerOn : null}
      closeLabel={t.close}
      onClose={onClose}
      footer={footer}
    >
      {preview.applicable ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2">
            <div
              className={`rounded-2xl border-2 p-3 ${preview.customerSaving >= 0 ? 'border-free bg-free-bg' : 'border-line bg-surface-2'}`}
            >
              <dt className="text-sm text-muted">{t.offerWith}</dt>
              <dd className="text-xl font-bold">
                <Price amount={preview.withOffer} />
              </dd>
            </div>
            <div
              className={`rounded-2xl border-2 p-3 ${preview.customerSaving < 0 ? 'border-promo bg-promo-bg' : 'border-line bg-surface-2'}`}
            >
              <dt className="text-sm text-muted">{t.offerWithout(PRICING.defaultDiscountPercent)}</dt>
              <dd className="text-xl font-bold">
                <Price amount={preview.withoutOffer} />
              </dd>
            </div>
          </dl>
          {preview.customerSaving >= 0 ? (
            <p className="font-medium text-free">{t.offerSaves(`${formatMoney(preview.customerSaving)} ${t.currency}`)}</p>
          ) : (
            <p className="rounded-xl bg-promo-bg p-3 font-medium text-promo">
              {t.offerCostsMore(`${formatMoney(-preview.customerSaving)} ${t.currency}`)}
            </p>
          )}
          <p className="text-sm text-muted">{t.offerLaterPieces}</p>
        </div>
      ) : (
        <p className="pb-2 text-base">{t.offerNeeds(preview.minUnits)}</p>
      )}
    </Sheet>
  );
}
