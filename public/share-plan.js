// The read-only viewer does not load map APIs or remote tiles.
for (const image of document.querySelectorAll('.itinerary-preview img')) {
  function showError() {
    const notice = image.closest('figure').querySelector('.itinerary-image-error');
    if (notice) notice.hidden = false;
    image.hidden = true;
  }
  image.addEventListener('error', showError);
  if (image.complete && !image.naturalWidth) showError();
}
