"use client";

import Image from "next/image";
import { useState } from "react";

type BeforeAfterImage = {
  src: string;
  alt: string;
};

type BeforeAfterPair = {
  title: string;
  before: BeforeAfterImage;
  after: BeforeAfterImage;
};

export function BeforeAfterCarousel({ pairs }: { pairs: BeforeAfterPair[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const activePair = pairs[activeIndex];

  function showPrevious() {
    setActiveIndex((index) => (index === 0 ? pairs.length - 1 : index - 1));
  }

  function showNext() {
    setActiveIndex((index) => (index === pairs.length - 1 ? 0 : index + 1));
  }

  function handleTouchEnd(clientX: number) {
    if (touchStart === null) {
      return;
    }

    const distance = touchStart - clientX;
    if (Math.abs(distance) > 48) {
      if (distance > 0) {
        showNext();
      } else {
        showPrevious();
      }
    }
    setTouchStart(null);
  }

  return (
    <div
      className="before-after-carousel"
      aria-roledescription="carousel"
      aria-label="Junk removal before and after project photos"
      onTouchStart={(event) => setTouchStart(event.changedTouches[0].clientX)}
      onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0].clientX)}
    >
      <div className="carousel-toolbar">
        <div>
          <p className="carousel-kicker">
            Project {activeIndex + 1} of {pairs.length}
          </p>
          <h3>{activePair.title}</h3>
        </div>
        <div className="carousel-controls">
          <button
            type="button"
            onClick={showPrevious}
            aria-label="Show previous before and after project"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={showNext}
            aria-label="Show next before and after project"
          >
            Next
          </button>
        </div>
      </div>

      <div className="before-after-slide" aria-live="polite">
        <figure className="comparison-card">
          <span className="comparison-label">Before</span>
          <Image
            src={activePair.before.src}
            alt={activePair.before.alt}
            width={900}
            height={1200}
            sizes="(max-width: 760px) 100vw, 45vw"
          />
        </figure>
        <figure className="comparison-card">
          <span className="comparison-label comparison-label--after">After</span>
          <Image
            src={activePair.after.src}
            alt={activePair.after.alt}
            width={900}
            height={1200}
            sizes="(max-width: 760px) 100vw, 45vw"
          />
        </figure>
      </div>
    </div>
  );
}
