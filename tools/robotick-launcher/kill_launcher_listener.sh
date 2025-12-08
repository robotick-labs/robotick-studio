#!/bin/bash
echo "Stopping robotick-launcher listen..."
pkill -f "robotick-launcher listen" || true
