import { GoogleReviews } from "@/components/google-reviews";
import { getReviewsSource } from "@/lib/reviews";

// What pages use (R7.1, R7.7). They never know where reviews come from: this
// asks the provider and renders whatever it describes. Nothing at all is
// rendered until reviews are configured.

/** Star rating, review count and recent reviews: the home page block. */
export function ReviewsBlock() {
  const source = getReviewsSource();
  if (source.kind === "none") return null;
  return <GoogleReviews apiKey={source.apiKey} placeId={source.placeId} writeReviewUrl={source.writeReviewUrl} variant="full" />;
}

/** A small rating badge: the menu page. */
export function ReviewsBadge() {
  const source = getReviewsSource();
  if (source.kind === "none") return null;
  return <GoogleReviews apiKey={source.apiKey} placeId={source.placeId} writeReviewUrl={source.writeReviewUrl} variant="badge" />;
}
