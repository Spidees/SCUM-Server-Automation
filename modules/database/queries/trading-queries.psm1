# ===============================================================
# SCUM Server Automation - Database Trading Queries
# ===============================================================
# SQL queries for economy, traders, and trading system
# Provides access to game economy and trader information
# ===============================================================

# Queries for economy, traders, and trading system
$script:TradingQueries = @{
    
    # Trader information
    GetAllTraders = @(
        "SELECT * FROM economy_traders ORDER BY id"
    )
    
    GetTraderById = @(
        "SELECT * FROM economy_traders WHERE id = @trader_id"
    )
    
    GetTradersByMap = @(
        "SELECT * FROM economy_traders WHERE map_id = @map_id ORDER BY id"
    )
    
    # Trader inventory and items
    GetTraderInventory = @(
        "SELECT 
         tradeable_asset as item_name,
         amount_in_store,
         restock_amount,
         base_buy_price,
         base_sell_price,
         trader_id
         FROM economy_tradeables_info 
         WHERE trader_id = @trader_id
         ORDER BY tradeable_asset"
    )
    
    GetItemByName = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE tradeable_asset LIKE @item_name
         ORDER BY base_buy_price"
    )
    
    GetExpensiveItems = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE base_buy_price > @min_price
         ORDER BY base_buy_price DESC LIMIT @limit"
    )
    
    GetCheapItems = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE base_buy_price < @max_price
         ORDER BY base_buy_price ASC LIMIT @limit"
    )
    
    # Special deals and discounts
    GetAllSpecialDeals = @(
        "SELECT * FROM economy_special_deals ORDER BY base_discount DESC LIMIT @limit"
    )
    
    GetPlayerDeals = @(
        "SELECT * FROM economy_special_deals 
         WHERE user_profile_id = @player_id
         ORDER BY base_discount DESC"
    )
    
    GetDealsBySector = @(
        "SELECT * FROM economy_special_deals 
         WHERE sector = @sector
         ORDER BY base_discount DESC LIMIT @limit"
    )
    
    GetBestDeals = @(
        "SELECT * FROM economy_special_deals 
         WHERE base_discount > @min_discount
         ORDER BY base_discount DESC LIMIT @limit"
    )
    
    GetDealsByItem = @(
        "SELECT * FROM economy_special_deals 
         WHERE tradeable_asset LIKE @item_name
         ORDER BY base_discount DESC"
    )
    
    # Trading statistics
    GetTradingStats = @(
        "SELECT 
         COUNT(*) as total_deals,
         AVG(base_discount) as avg_discount,
         MAX(base_discount) as max_discount,
         MIN(base_discount) as min_discount
         FROM economy_special_deals"
    )
    
    GetDealsBySector_Stats = @(
        "SELECT 
         sector,
         COUNT(*) as deals_count,
         AVG(base_discount) as avg_discount,
         MAX(base_discount) as max_discount
         FROM economy_special_deals 
         GROUP BY sector
         ORDER BY deals_count DESC"
    )
    
    GetTraderStats = @(
        "SELECT 
         COUNT(*) as total_traders,
         COUNT(DISTINCT map_id) as maps_with_traders,
         COUNT(DISTINCT user_profile_id) as traders_with_profiles
         FROM economy_traders"
    )
    
    GetItemStats = @(
        "SELECT 
         COUNT(*) as total_items,
         COUNT(DISTINCT tradeable_asset) as unique_items,
         AVG(base_buy_price) as avg_buy_price,
         AVG(base_sell_price) as avg_sell_price,
         MAX(base_buy_price) as max_price,
         MIN(base_buy_price) as min_price
         FROM economy_tradeables_info"
    )
    
    # Item availability and stock
    GetLowStockItems = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE amount_in_store < @threshold
         ORDER BY amount_in_store ASC"
    )
    
    GetHighStockItems = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE amount_in_store > @threshold
         ORDER BY amount_in_store DESC LIMIT @limit"
    )
    
    GetRestockNeeded = @(
        "SELECT * FROM economy_tradeables_info 
         WHERE amount_in_store < (restock_amount * 0.2)
         ORDER BY (amount_in_store / restock_amount) ASC"
    )
    
    # Price analysis
    GetPriceRanges = @(
        "SELECT 
         tradeable_asset,
         MIN(base_buy_price) as min_buy,
         MAX(base_buy_price) as max_buy,
         AVG(base_buy_price) as avg_buy,
         COUNT(*) as trader_count
         FROM economy_tradeables_info 
         GROUP BY tradeable_asset
         HAVING COUNT(*) > 1
         ORDER BY (MAX(base_buy_price) - MIN(base_buy_price)) DESC"
    )
}

Export-ModuleMember -Variable TradingQueries
