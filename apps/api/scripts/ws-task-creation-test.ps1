$uri = [Uri]"ws://localhost:4000/ws/task-creation"
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync($uri, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$sendText = '{"type":"user_input","content":"创建一个新产品的营销计划"}'
$sendBytes = [Text.Encoding]::UTF8.GetBytes($sendText)
$ws.SendAsync([ArraySegment[byte]]::new($sendBytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$buffer = New-Object byte[] 8192
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
while ($stopwatch.Elapsed.TotalMinutes -lt 10 -and $ws.State -eq 'Open') {
  $result = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
  $msg = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
  $timestamp = (Get-Date).ToString('o')
  Add-Content -Path $env:WS_TEST_LOG -Value ("$timestamp $msg")
}
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult()
