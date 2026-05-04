import asyncio
from playwright.async_api import async_playwright
import json

async def scrape_gwu_directory():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Target the main faculty search page
        await page.goto("https://facultyprofiles.gwu.edu/search")
        
        faculty_data = []
        
        # Logic to handle pagination and extraction
        # This selects the names and profile links from the search results
        profiles = await page.query_selector_all(".profile-item") 
        
        for profile in profiles:
            name = await profile.query_selector(".name")
            link = await profile.query_selector("a")
            
            faculty_data.append({
                "name": await name.inner_text() if name else "N/A",
                "profile_url": await link.get_attribute("href") if link else "N/A"
            })
            
        with open("data/faculty_urls.json", "w") as f:
            json.dump(faculty_data, f, indent=4)
            
        print(f"✅ Successfully extracted {len(faculty_data)} profile URLs.")
        await browser.close()

asyncio.run(scrape_gwu_directory())