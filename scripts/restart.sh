
#!/bin/bash
set -e

echo "Starte TradingJournal neu..."
sudo systemctl restart tradingjournal

echo ""
echo "Aktueller Status:"
sudo systemctl status tradingjournal --no-pager
