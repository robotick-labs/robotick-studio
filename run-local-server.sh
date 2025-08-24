echo ""
echo -e "\033[1mPreparing to serve on http://localhost:8000\033[0m"
echo ""

python3 -m http.server 8000 --bind localhost --directory public/

