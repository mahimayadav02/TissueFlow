// "How this page works" text for each page, kept in one place so it is easy to edit.
// Each entry is shown in a panel under the page title when the reader opens it.

export const HELP = {
  dashboard: (
    <ul>
      <li><b>Handled today</b> counts the bottles operators entered today, all work combined (sub-culture, washing, media, checks), against the targets supervisors gave.</li>
      <li><b>Loss, 30 days</b> is bottles lost divided by bottles sub-cultured in the last 30 days.</li>
      <li><b>Plants ready in 6 months</b> adds up the forecast of every running batch.</li>
      <li><b>Profit</b> is last month’s plants sent × their order rate, minus the costs entered for that month.</li>
      <li>Hover a bar in the chart to see that day’s numbers.</li>
    </ul>
  ),
  zones: (
    <ul>
      <li>Each card is one zone: who is present, work against target, trays kept there, and open alerts.</li>
      <li>Pick a date to see an earlier day. Open a card for that zone’s own page.</li>
      <li>Zones, rooms and benches are set on Lab set-up; supervisors are given zones on Users.</li>
    </ul>
  ),
  zone: (
    <ul>
      <li>The page shows only what fits this zone: operators and targets where people work, trays and benches where cultures are kept, media lots in the media zone, readings where there is a sensor.</li>
      <li><b>Oldest</b> turns amber or red when trays stay in a stage longer than the limit in Alert limits.</li>
    </ul>
  ),
  batches: (
    <ol>
      <li>Click <b>New batch</b> and enter the samples collected; the batch code (B, month, year) is given for you.</li>
      <li>Its bottles are put into trays of up to 30, each with its own QR code.</li>
      <li>Open a batch to see bottles by stage, its stage history, losses and samples, to split it, or to print its labels.</li>
    </ol>
  ),
  batch: (
    <ul>
      <li><b>Bottles by stage</b> shows where the batch is now. A batch can sit in two stages at once after a split.</li>
      <li><b>Split into new part</b> (manager) moves the trays you tick into a new part of the batch with the same code plus a letter.</li>
      <li><b>Print labels</b> opens a sheet of QR labels for the ticked trays, or all of them; <b>Move to bench</b> moves the ticked trays.</li>
    </ul>
  ),
  trays: (
    <ol>
      <li>Find a tray by scanning its label with the camera or typing its code, such as B1-26-0004.</li>
      <li><b>Sub-culture</b> records the new bottles made and any lost; new trays and codes are made for you.</li>
      <li><b>Move to bench</b> puts trays on another bench; <b>Record loss</b> notes contaminated bottles with their cause.</li>
    </ol>
  ),
  losses: (
    <ul>
      <li>Every bottle lost is recorded with its cause: lab, operator, season or media lot.</li>
      <li>Pick a period to see losses by cause, stage and zone; a cause that keeps growing is the one to act on.</li>
      <li>Losses found during a sub-culture are recorded there automatically.</li>
    </ul>
  ),
  daily: (
    <ul>
      <li>One row per operator: attendance, the work given, the target, and the bottles handled so far.</li>
      <li><b>To check</b> is entries waiting for the supervisor.</li>
      <li>Red and amber appear only once a day is over, using the “Operator below target” limits.</li>
    </ul>
  ),
  attendance: (
    <ol>
      <li>At the start of the shift, tap Present, Half day or Absent for each operator.</li>
      <li><b>Rest present</b> marks everyone not yet marked as present.</li>
      <li>Save. Attendance can be changed for up to 7 days back.</li>
    </ol>
  ),
  assign: (
    <ul>
      <li>Click <b>Add</b> for an operator. The form follows their zone: <b>inoculation</b> asks for batch, stage, hood and bottles to sub-culture; <b>washing</b> shows the bottles and contaminated bottles waiting and asks how many of each to wash; <b>media preparation</b> shows the bottles ready for each media code and asks for the media code, batch code and bottles to be made; <b>quality check</b> asks for media or culture bottles to check.</li>
      <li>An operator who works in two zones can get work in each. Each laminar-flow hood takes at most 2 operators a day.</li>
      <li>Bottles emptied at sub-culture are added to the wash area count by themselves.</li>
      <li>Work not finished by the end of the day is never taken out of stock, so it simply stays where it was for the next day.</li>
      <li><b>Record work</b> lets you type in the counts an operator reports (up to 7 days back). What you enter counts as checked.</li>
      <li><b>Copy last working day</b> repeats yesterday’s work for everyone who is present (media gets a new batch code).</li>
    </ul>
  ),
  verify: (
    <ul>
      <li>Every piece of work an operator scans or types in waits here until you check it.</li>
      <li><b>Verify</b> confirms the counts. <b>Send back</b> asks the operator to redo it. If nothing has used what it made, it is undone too: a sub-culture’s new trays are removed and the bottles go back to their trays; media bottles come off their batch.</li>
      <li><b>Look at</b> flags numbers worth a second look, such as unusual growth or high loss.</li>
    </ul>
  ),
  output: (
    <ul>
      <li>The top numbers are every kind of work added together for the dates chosen: sub-culture, washing, media made and bottles checked.</li>
      <li>Pick an operator, zone, work, batch or stage to narrow it down, or click any row in the tables below to filter by it.</li>
      <li>An operator who works in two zones is counted in each zone for the work done there.</li>
      <li>Only verified and waiting entries count; entries sent back do not. <b>Excel</b> downloads every table.</li>
    </ul>
  ),
  stock: (
    <ul>
      <li><b>Receive</b> adds stock, <b>Use</b> takes it out, <b>Count</b> corrects it after a shelf count (with a reason).</li>
      <li><b>Make media lot</b> records a batch of medium and takes its chemicals out of stock. Its use-by date comes from the recipe.</li>
      <li>Items at or below their reorder level are marked Reorder and raise an alert.</li>
    </ul>
  ),
  orders: (
    <ol>
      <li>Click <b>New order</b>, enter the customer, crop, plants, rate and date needed, then <b>Check order</b>.</li>
      <li>The check adds up the plants every running batch of that crop will give by that date, minus plants already promised.</li>
      <li>It answers Yes, Partly or No, with the expected revenue, cost and profit. Save the order, then record plants as they are sent.</li>
    </ol>
  ),
  costs: (
    <ul>
      <li>Enter the month’s totals for each heading; no bills needed.</li>
      <li><b>Cost per bottle-round</b> = the month’s total ÷ bottles handled that month. Each batch’s cost is built from it.</li>
      <li><b>Profit</b> = plants sent that month × their rate − the month’s costs.</li>
    </ul>
  ),
  forecast: (
    <ul>
      <li>Worked out from each batch’s own records every time the page opens.</li>
      <li>Expected plants = bottles now × growth for each round left × rooting survival × hardening survival.</li>
      <li>Open a batch row to see each stage group. Change the survival rates in <b>Forecast assumptions</b>.</li>
    </ul>
  ),
  monitoring: (
    <ul>
      <li>Shows the growth room’s temperature, humidity and light. Readings are sample values until the sensor node is installed.</li>
      <li>Dashed lines are the warning and critical limits from Alert limits. Hover a line to read a value.</li>
      <li>The page refreshes itself every minute.</li>
    </ul>
  ),
  alerts: (
    <ul>
      <li>Alerts are raised automatically when a limit in Alert limits is crossed: overdue trays, low output, high loss, low stock, room conditions.</li>
      <li>Click <b>OK</b> on an alert, or tick several and click <b>Acknowledge</b>, once someone is dealing with it. Your name is kept with it.</li>
    </ul>
  ),
  audit: (
    <ul>
      <li>Every change made in the app is recorded with who made it and when, including sign-ins.</li>
      <li>Filter by person or action, or search for a batch or tray code.</li>
    </ul>
  ),
  setup: (
    <ol>
      <li>Enter the lab’s details, then its zones (rooms) and the benches or racks in each, with how many trays each holds.</li>
      <li>Next, set crops, stages, media recipes and alert limits, then add your staff on Users.</li>
    </ol>
  ),
  users: (
    <ul>
      <li>Add each person with their role. Supervisors get one or more zones; operators get a home zone.</li>
      <li>A person who leaves is marked as left, so their past records keep their name.</li>
    </ul>
  ),
};
