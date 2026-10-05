import React from 'react';

// Shown before a trip is planned: says what the planner produces, with a small sample of the log line.
export default function PlanPreview() {
  return (
    <div className="Card PlanPreview">
      <div className="PlanPreviewBody">
        <h2 className="PlanPreviewTitle">Your trip plan will appear here</h2>
        <p className="PlanPreviewText">
          Enter where you are, where you pick up and where you deliver, plus the hours you have already used this
          cycle. The planner works out when you must stop to stay inside the hours-of-service rules.
        </p>
        <ul className="PlanPreviewList">
          <li>A map of the driving route with every break, rest and fuel stop</li>
          <li>A stop-by-stop timeline, grouped by day</li>
          <li>A daily log sheet for each day, with remarks and hour totals that add up to 24</li>
        </ul>
      </div>

      {/* Decorative sample of a duty-status line. */}
      <svg className="PlanPreviewSample" viewBox="0 0 240 72" aria-hidden="true" focusable="false">
        <rect className="LogGridBox" x="1" y="1" width="238" height="70" rx="3" />
        <line className="LogGridRowLine" x1="1" x2="239" y1="18.5" y2="18.5" />
        <line className="LogGridRowLine" x1="1" x2="239" y1="36" y2="36" />
        <line className="LogGridRowLine" x1="1" x2="239" y1="53.5" y2="53.5" />
        <line className="LogSheetRun" data-status="OFF_DUTY" strokeWidth="3" x1="8" x2="52" y1="9.5" y2="9.5" />
        <line className="LogSheetChange" strokeWidth="1.5" x1="52" x2="52" y1="9.5" y2="45" />
        <line className="LogSheetRun" data-status="DRIVING" strokeWidth="3" x1="52" x2="128" y1="45" y2="45" />
        <line className="LogSheetChange" strokeWidth="1.5" x1="128" x2="128" y1="45" y2="62" />
        <line className="LogSheetRun" data-status="ON_DUTY" strokeWidth="3" x1="128" x2="152" y1="62" y2="62" />
        <line className="LogSheetChange" strokeWidth="1.5" x1="152" x2="152" y1="45" y2="62" />
        <line className="LogSheetRun" data-status="DRIVING" strokeWidth="3" x1="152" x2="196" y1="45" y2="45" />
        <line className="LogSheetChange" strokeWidth="1.5" x1="196" x2="196" y1="9.5" y2="45" />
        <line className="LogSheetRun" data-status="OFF_DUTY" strokeWidth="3" x1="196" x2="232" y1="9.5" y2="9.5" />
      </svg>
    </div>
  );
}
