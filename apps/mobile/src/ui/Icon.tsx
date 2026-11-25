import Svg, { Path, Circle, Rect } from "react-native-svg";

export type IconName = "home" | "savings" | "pay" | "credit" | "more" | "copy" | "check" | "lock" | "external" | "chevron" | "drop" | "shield" | "clock" | "alert" | "bridge" | "plus" | "info" | "wallet" | "gift" | "help" | "search" | "book";

export function Icon({ name, size = 24, color = "#000", strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && (<><Path {...p} d="M4 11.2 12 4l8 7.2" /><Path {...p} d="M6 10v9h12v-9" /><Path {...p} d="M10 19v-5h4v5" /></>)}
      {name === "savings" && (<><Rect {...p} x="3.5" y="7" width="17" height="12" rx="3" /><Path {...p} d="M3.5 11h17" /><Path {...p} d="M7.5 15h3" /></>)}
      {name === "pay" && (<><Path {...p} d="M4 9h13l-3-3" /><Path {...p} d="M20 15H7l3 3" /></>)}
      {name === "credit" && (<><Path {...p} d="M4 18 9 12l3.5 3L20 6" /><Path {...p} d="M15 6h5v5" /></>)}
      {name === "more" && (<><Circle cx="6" cy="12" r="1.4" fill={color} /><Circle cx="12" cy="12" r="1.4" fill={color} /><Circle cx="18" cy="12" r="1.4" fill={color} /></>)}
      {name === "copy" && (<><Rect {...p} x="8.5" y="8.5" width="11" height="11" rx="2.5" /><Path {...p} d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>)}
      {name === "check" && <Path {...p} d="m5 12.5 4.5 4.5L19 7.5" />}
      {name === "lock" && (<><Rect {...p} x="5" y="10.5" width="14" height="9.5" rx="2.5" /><Path {...p} d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>)}
      {name === "external" && (<><Path {...p} d="M14 5h5v5" /><Path {...p} d="m19 5-8 8" /><Path {...p} d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5H10" /></>)}
      {name === "chevron" && <Path {...p} d="m9.5 6 6 6-6 6" />}
      {name === "drop" && <Path {...p} d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 6-10.2 6-10.2Z" />}
      {name === "shield" && (<><Path {...p} d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6l-7-2.5Z" /><Path {...p} d="m9 12 2.2 2.2L15.5 10" /></>)}
      {name === "clock" && (<><Circle {...p} cx="12" cy="12" r="8.5" /><Path {...p} d="M12 7.5V12l3 2" /></>)}
      {name === "alert" && (<><Path {...p} d="M12 4 3.5 19h17L12 4Z" /><Path {...p} d="M12 10v4" /><Circle cx="12" cy="16.6" r="0.9" fill={color} /></>)}
      {name === "bridge" && (<><Path {...p} d="M4 15c2-6 14-6 16 0" /><Path {...p} d="M3 15h18" /><Path {...p} d="M8 11.6V15M12 10.6V15M16 11.6V15" /></>)}
      {name === "plus" && <Path {...p} d="M12 5v14M5 12h14" />}
      {name === "wallet" && (<><Rect {...p} x="3.5" y="6" width="17" height="13" rx="3" /><Path {...p} d="M3.5 10h17" /><Circle cx="16.5" cy="14.5" r="1.1" fill={color} /></>)}
      {name === "gift" && (<><Rect {...p} x="4" y="9" width="16" height="10.5" rx="2" /><Path {...p} d="M12 9v10.5M3.5 9h17" /><Path {...p} d="M12 9c-1.5-3.5-5-3.5-5-1.4S10.5 9 12 9Zm0 0c1.5-3.5 5-3.5 5-1.4S13.5 9 12 9Z" /></>)}
      {name === "help" && (<><Circle {...p} cx="12" cy="12" r="8.5" /><Path {...p} d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.7" /><Circle cx="12" cy="16.6" r="0.9" fill={color} /></>)}
      {name === "search" && (<><Circle {...p} cx="11" cy="11" r="6.5" /><Path {...p} d="m16 16 4 4" /></>)}
      {name === "book" && (<><Path {...p} d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14.5H6.5A1.5 1.5 0 0 0 5 20V5.5Z" /><Path {...p} d="M5 20a1.5 1.5 0 0 0 1.5 1.5H19" /></>)}
      {name === "info" && (<><Circle {...p} cx="12" cy="12" r="8.5" /><Path {...p} d="M12 11v5" /><Circle cx="12" cy="8" r="0.9" fill={color} /></>)}
    </Svg>
  );
}
