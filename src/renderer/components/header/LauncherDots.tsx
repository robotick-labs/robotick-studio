import React, { useEffect, useState } from "react";
import { LauncherStatus } from "../../core/launcher-context";

type LauncherDotsProps = {
  status: LauncherStatus;
};

export function LauncherDots({ status }: LauncherDotsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [status]);

  useEffect(() => {
    if (status !== "starting") return;
    const id = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, [status]);

  return (
    <span className="launcher-control-dots" aria-hidden>
      <span className="launcher-dots">
        {[0, 1, 2].map((index) => {
          let className = "dot";

          if (status === "starting" && index === activeIndex) {
            className += " active";
          } else if (status === "running") {
            className += index === 1 ? " heartbeat-on" : " heartbeat-off";
          }

          return <span key={index} className={className}></span>;
        })}
      </span>
    </span>
  );
}
